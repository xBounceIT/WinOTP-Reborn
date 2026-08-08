use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::models::{OtpAccount, SortOption};

pub fn normalize_custom_order_ids<I, S>(ids: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for id in ids {
        let normalized = id.as_ref().trim();
        if !normalized.is_empty() && seen.insert(normalized.to_string()) {
            result.push(normalized.to_string());
        }
    }
    result
}

pub fn apply_custom_order(accounts: &[OtpAccount], saved_order_ids: &[String]) -> Vec<OtpAccount> {
    let account_by_id = accounts.iter().fold(HashMap::new(), |mut map, account| {
        if !account.id.is_empty() {
            map.entry(account.id.clone())
                .or_insert_with(|| account.clone());
        }
        map
    });

    let mut ordered = Vec::new();
    let mut used_ids = HashSet::new();
    for id in normalize_custom_order_ids(saved_order_ids.iter().map(String::as_str)) {
        if let Some(account) = account_by_id.get(&id) {
            used_ids.insert(id);
            ordered.push(account.clone());
        }
    }

    let mut unlisted = accounts
        .iter()
        .filter(|account| !used_ids.contains(&account.id))
        .cloned()
        .collect::<Vec<_>>();
    unlisted.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    ordered.extend(unlisted);
    ordered
}

pub fn prune_custom_order_ids(saved_order_ids: &[String], accounts: &[OtpAccount]) -> Vec<String> {
    let existing_ids = accounts
        .iter()
        .map(|account| account.id.as_str())
        .collect::<HashSet<_>>();
    normalize_custom_order_ids(saved_order_ids.iter().map(String::as_str))
        .into_iter()
        .filter(|id| existing_ids.contains(id.as_str()))
        .collect()
}

pub fn sort_accounts(
    accounts: &[OtpAccount],
    sort_option: SortOption,
    custom_order_ids: &[String],
) -> Vec<OtpAccount> {
    if sort_option == SortOption::CustomOrder {
        return apply_custom_order(accounts, custom_order_ids);
    }

    let mut sorted = accounts.to_vec();
    sorted.sort_by(|left, right| match sort_option {
        SortOption::DateAddedAsc => left
            .created_at
            .cmp(&right.created_at)
            .then_with(|| left.id.cmp(&right.id)),
        SortOption::AlphabeticalAsc => left
            .display_label()
            .cmp(&right.display_label())
            .then_with(|| left.id.cmp(&right.id)),
        SortOption::AlphabeticalDesc => right
            .display_label()
            .cmp(&left.display_label())
            .then_with(|| left.id.cmp(&right.id)),
        SortOption::UsageBased => right
            .usage_count
            .cmp(&left.usage_count)
            .then_with(|| right.last_used_at.cmp(&left.last_used_at))
            .then_with(|| right.created_at.cmp(&left.created_at))
            .then_with(|| left.id.cmp(&right.id)),
        SortOption::DateAddedDesc | SortOption::CustomOrder => right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| left.id.cmp(&right.id)),
    });
    sorted
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemBounds {
    pub id: String,
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default = "default_source_index")]
    pub source_index: i32,
}

fn default_source_index() -> i32 {
    -1
}

impl ItemBounds {
    fn bottom(&self) -> f64 {
        self.top + self.height
    }

    fn center_x(&self) -> f64 {
        self.left + self.width / 2.0
    }

    fn center_y(&self) -> f64 {
        self.top + self.height / 2.0
    }
}

#[derive(Debug)]
struct VisualRow {
    top: f64,
    bottom: f64,
    items: Vec<(ItemBounds, usize)>,
    min_effective_index: usize,
    max_effective_index: usize,
}

fn effective_index(bounds: &ItemBounds, index: usize) -> usize {
    if bounds.source_index >= 0 {
        bounds.source_index as usize
    } else {
        index
    }
}

fn build_rows(bounds: &[ItemBounds]) -> Vec<VisualRow> {
    let mut indexed = bounds.iter().cloned().enumerate().collect::<Vec<_>>();
    indexed.sort_by(|(_, left), (_, right)| {
        left.top
            .partial_cmp(&right.top)
            .unwrap_or(Ordering::Equal)
            .then_with(|| {
                left.left
                    .partial_cmp(&right.left)
                    .unwrap_or(Ordering::Equal)
            })
    });

    let mut rows = Vec::new();
    for (index, item) in indexed {
        let row = rows
            .last_mut()
            .and_then(|row: &mut VisualRow| (item.center_y() <= row.bottom).then_some(row));
        let row = match row {
            Some(row) => row,
            None => {
                rows.push(VisualRow {
                    top: item.top,
                    bottom: item.bottom(),
                    items: Vec::new(),
                    min_effective_index: usize::MAX,
                    max_effective_index: 0,
                });
                rows.last_mut().expect("new row exists")
            }
        };
        row.top = row.top.min(item.top);
        row.bottom = row.bottom.max(item.bottom());
        let effective = effective_index(&item, index);
        row.items.push((item, index));
        row.min_effective_index = row.min_effective_index.min(effective);
        row.max_effective_index = row.max_effective_index.max(effective);
        row.items.sort_by(|(left, _), (right, _)| {
            left.left
                .partial_cmp(&right.left)
                .unwrap_or(Ordering::Equal)
        });
    }
    rows
}

pub fn get_drop_insertion_index(bounds: &[ItemBounds], x: f64, y: f64) -> usize {
    if bounds.is_empty() {
        return 0;
    }

    let rows = build_rows(bounds);
    for row in &rows {
        if y < row.top {
            return row.min_effective_index;
        }
        if y > row.bottom {
            continue;
        }
        if row.items.len() == 1 {
            let (item, index) = &row.items[0];
            let effective = effective_index(item, *index);
            return if y < item.center_y() {
                effective
            } else {
                effective + 1
            };
        }
        for (item, index) in &row.items {
            if x < item.center_x() {
                return effective_index(item, *index);
            }
        }
        return row.max_effective_index + 1;
    }
    rows.last()
        .map(|row| row.max_effective_index + 1)
        .unwrap_or(0)
}

pub fn try_get_target_index(
    current_index: i32,
    insertion_index: i32,
    count: usize,
) -> Option<usize> {
    if current_index < 0 || current_index as usize >= count {
        return None;
    }
    let mut candidate = insertion_index.clamp(0, count as i32);
    if current_index < candidate {
        candidate -= 1;
    }
    let target = candidate as usize;
    if candidate == current_index || target >= count {
        None
    } else {
        Some(target)
    }
}

pub fn project_order(
    ordered_ids: &[String],
    dragged_id: &str,
    insertion_index: i32,
) -> Vec<String> {
    let mut projected = ordered_ids.to_vec();
    let current_index = projected.iter().position(|id| id == dragged_id);
    let Some(current_index) = current_index else {
        return projected;
    };
    let Some(target_index) =
        try_get_target_index(current_index as i32, insertion_index, projected.len())
    else {
        return projected;
    };
    projected.remove(current_index);
    projected.insert(target_index, dragged_id.to_string());
    projected
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::OtpAccount;

    fn account(id: &str, day: &str) -> OtpAccount {
        OtpAccount {
            id: id.to_string(),
            secret: "JBSWY3DPEHPK3PXP".to_string(),
            created_at: format!("2026-01-{day}T00:00:00.000Z"),
            ..Default::default()
        }
    }

    #[test]
    fn custom_order_keeps_saved_ids_then_adds_newest() {
        let accounts = vec![
            account("old", "01"),
            account("saved", "02"),
            account("new", "03"),
        ];
        let result = apply_custom_order(&accounts, &["saved".to_string()]);
        assert_eq!(
            result
                .iter()
                .map(|account| account.id.as_str())
                .collect::<Vec<_>>(),
            ["saved", "new", "old"]
        );
    }

    #[test]
    fn wrapped_layout_uses_row_and_column_position() {
        let bounds = vec![
            ItemBounds {
                id: "one".into(),
                left: 0.0,
                top: 0.0,
                width: 300.0,
                height: 100.0,
                source_index: -1,
            },
            ItemBounds {
                id: "two".into(),
                left: 370.0,
                top: 0.0,
                width: 300.0,
                height: 100.0,
                source_index: -1,
            },
            ItemBounds {
                id: "three".into(),
                left: 0.0,
                top: 150.0,
                width: 300.0,
                height: 100.0,
                source_index: -1,
            },
        ];
        assert_eq!(get_drop_insertion_index(&bounds, 500.0, 40.0), 1);
        assert_eq!(get_drop_insertion_index(&bounds, 720.0, 40.0), 2);
    }
}
