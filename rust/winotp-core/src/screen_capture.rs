use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PixelRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CaptureSelection {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CaptureCanvas {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CaptureImage {
    pub width: i32,
    pub height: i32,
}

pub fn map_to_pixel_rect(
    selection: CaptureSelection,
    canvas: CaptureCanvas,
    image: CaptureImage,
) -> Option<PixelRect> {
    if selection.width <= 0.0
        || selection.height <= 0.0
        || canvas.width <= 0.0
        || canvas.height <= 0.0
        || image.width <= 0
        || image.height <= 0
    {
        return None;
    }

    let scale_x = image.width as f64 / canvas.width;
    let scale_y = image.height as f64 / canvas.height;
    let left = (selection.x * scale_x)
        .floor()
        .clamp(0.0, image.width as f64) as i32;
    let top = (selection.y * scale_y)
        .floor()
        .clamp(0.0, image.height as f64) as i32;
    let right = ((selection.x + selection.width) * scale_x)
        .ceil()
        .clamp(0.0, image.width as f64) as i32;
    let bottom = ((selection.y + selection.height) * scale_y)
        .ceil()
        .clamp(0.0, image.height as f64) as i32;
    let width = right - left;
    let height = bottom - top;
    (width > 0 && height > 0).then_some(PixelRect {
        x: left,
        y: top,
        width,
        height,
    })
}

pub fn expand(rect: PixelRect, image_width: i32, image_height: i32, padding: i32) -> PixelRect {
    if padding <= 0 {
        return rect;
    }
    let left = (rect.x - padding).max(0);
    let top = (rect.y - padding).max(0);
    let right = (rect.x + rect.width + padding).min(image_width);
    let bottom = (rect.y + rect.height + padding).min(image_height);
    PixelRect {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    }
}

pub fn quiet_zone_padding(rect: PixelRect) -> i32 {
    let shortest_side = rect.width.min(rect.height);
    ((shortest_side as f64 * 0.08).ceil() as i32).clamp(12, 64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_canvas_coordinates_and_clamps_to_image() {
        assert_eq!(
            map_to_pixel_rect(
                CaptureSelection {
                    x: -10.0,
                    y: 10.0,
                    width: 100.0,
                    height: 100.0,
                },
                CaptureCanvas {
                    width: 200.0,
                    height: 200.0,
                },
                CaptureImage {
                    width: 400,
                    height: 400,
                },
            ),
            Some(PixelRect {
                x: 0,
                y: 20,
                width: 180,
                height: 200
            })
        );
    }

    #[test]
    fn expands_and_bounds_quiet_zone_padding() {
        let rect = PixelRect {
            x: 100,
            y: 100,
            width: 250,
            height: 250,
        };
        assert_eq!(
            expand(rect, 400, 400, 20),
            PixelRect {
                x: 80,
                y: 80,
                width: 290,
                height: 290
            }
        );
        assert_eq!(
            quiet_zone_padding(PixelRect {
                x: 0,
                y: 0,
                width: 50,
                height: 50
            }),
            12
        );
        assert_eq!(
            quiet_zone_padding(PixelRect {
                x: 0,
                y: 0,
                width: 1000,
                height: 1000
            }),
            64
        );
    }
}
