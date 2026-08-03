import type { OtpAccount } from "@/lib/types";

export const demoAccounts: OtpAccount[] = [
  {
    id: "google-demo",
    issuer: "Google",
    accountName: "daniel@example.com",
    secret: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    createdAt: "2026-07-12T09:30:00.000Z",
    usageCount: 14,
  },
  {
    id: "github-demo",
    issuer: "GitHub",
    accountName: "dangelicodes",
    secret: "KRSXG5AANFZSAYJA",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    createdAt: "2026-07-21T13:12:00.000Z",
    usageCount: 9,
  },
  {
    id: "aws-demo",
    issuer: "AWS",
    accountName: "production",
    secret: "MFRGGZDFMZTWQ2LK",
    algorithm: "SHA256",
    digits: 8,
    period: 30,
    createdAt: "2026-07-28T16:45:00.000Z",
    usageCount: 4,
  },
];
