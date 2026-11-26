import type { ActivityItem, Ticket, User } from "./types";

export const previewAccounts = [
  {
    role: "REPORTER" as const,
    name: "Alex Morgan",
    email: "alex.morgan@fixit.local",
    password: "FixItPreview!",
  },
  {
    role: "SUPPORT_AGENT" as const,
    name: "Jordan Lee",
    email: "jordan.lee@fixit.local",
    password: "FixItPreview!",
  },
  {
    role: "ADMIN" as const,
    name: "Taylor Brooks",
    email: "taylor.brooks@fixit.local",
    password: "FixItPreview!",
  },
];

export const previewUsers: User[] = [
  {
    userId: "22222222-2222-4222-8222-222222222222",
    role: "REPORTER",
    displayName: "Alex Morgan",
    email: "alex.morgan@fixit.local",
  },
  {
    userId: "33333333-3333-4333-8333-333333333333",
    role: "SUPPORT_AGENT",
    displayName: "Jordan Lee",
    email: "jordan.lee@fixit.local",
  },
  {
    userId: "55555555-5555-4555-8555-555555555555",
    role: "ADMIN",
    displayName: "Taylor Brooks",
    email: "taylor.brooks@fixit.local",
  },
  {
    userId: "44444444-4444-4444-8444-444444444444",
    role: "SUPPORT_AGENT",
    displayName: "Morgan Patel",
    email: "morgan.patel@fixit.local",
  },
];

const reporterId = previewUsers[0]!.userId;
const agentId = previewUsers[1]!.userId;

export const seedTickets: Ticket[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    reference: "FX-1042",
    title: "Printer keeps dropping off the network",
    category: "PERIPHERALS",
    status: "ASSIGNED",
    urgency: "NORMAL",
    priority: "P2_HIGH",
    reporterId,
    reporterName: "Alex Morgan",
    assigneeId: agentId,
    assigneeName: "Jordan Lee",
    createdAt: "2026-11-26T14:18:00-06:00",
    updatedAt: "2026-11-26T16:42:00-06:00",
    description:
      "The printer on the second floor disappears from the network every few minutes. It comes back after a restart, but the queue gets stuck again.",
    location: "Building A · Floor 2",
    equipment: "HP LaserJet Pro M404",
    version: 2,
  },
  {
    id: "66666666-6666-4666-8666-666666666666",
    reference: "FX-1038",
    title: "Wi-Fi drops in Lab 204 during lectures",
    category: "NETWORK",
    status: "IN_PROGRESS",
    urgency: "HIGH",
    priority: "P1_CRITICAL",
    reporterId,
    reporterName: "Alex Morgan",
    assigneeId: agentId,
    assigneeName: "Jordan Lee",
    createdAt: "2026-11-26T09:10:00-06:00",
    updatedAt: "2026-11-26T15:54:00-06:00",
    description:
      "Several laptops lose connectivity at the same time. The access point stays online, but clients need to reconnect repeatedly.",
    location: "Building B · Lab 204",
    equipment: "Access point AP-204",
    version: 3,
  },
  {
    id: "77777777-7777-4777-8777-777777777777",
    reference: "FX-1034",
    title: "Cannot access the shared course drive",
    category: "ACCOUNTS",
    status: "OPEN",
    urgency: "NORMAL",
    priority: null,
    reporterId,
    reporterName: "Alex Morgan",
    assigneeId: null,
    assigneeName: null,
    createdAt: "2026-11-26T13:06:00-06:00",
    updatedAt: "2026-11-26T13:06:00-06:00",
    description:
      "The shared drive appears in File Explorer, but opening the course folder returns an access denied message.",
    location: "Library · Workstation 08",
    equipment: "Dell OptiPlex 7010",
    version: 1,
  },
  {
    id: "88888888-8888-4888-8888-888888888888",
    reference: "FX-1029",
    title: "Projector image is washed out in Room 3",
    category: "HARDWARE",
    status: "RESOLVED",
    urgency: "LOW",
    priority: "P3_NORMAL",
    reporterId,
    reporterName: "Alex Morgan",
    assigneeId: agentId,
    assigneeName: "Jordan Lee",
    createdAt: "2026-11-25T10:35:00-06:00",
    updatedAt: "2026-11-26T08:24:00-06:00",
    description:
      "The projected image looks pale even with brightness adjusted. The input cable has already been reseated.",
    location: "Building A · Room 3",
    equipment: "Epson PowerLite 2250U",
    version: 4,
  },
];

export const activityByTicket: Record<string, ActivityItem[]> = {
  "11111111-1111-4111-8111-111111111111": [
    {
      id: "act-1",
      label: "Ticket created",
      detail: "Request received and added to the support queue.",
      actor: "Alex Morgan",
      createdAt: "2026-11-26T14:18:00-06:00",
    },
    {
      id: "act-2",
      label: "Ticket claimed",
      detail: "Jordan Lee took ownership of this request.",
      actor: "Jordan Lee",
      createdAt: "2026-11-26T15:02:00-06:00",
    },
    {
      id: "act-3",
      label: "Priority set to P2 · High",
      detail: "The assigned agent reviewed the impact and set the official priority.",
      actor: "Jordan Lee",
      createdAt: "2026-11-26T15:06:00-06:00",
    },
  ],
  "66666666-6666-4666-8666-666666666666": [
    {
      id: "act-4",
      label: "Ticket created",
      detail: "Request received and added to the support queue.",
      actor: "Alex Morgan",
      createdAt: "2026-11-26T09:10:00-06:00",
    },
    {
      id: "act-5",
      label: "Work started",
      detail: "The assigned agent began checking the access point.",
      actor: "Jordan Lee",
      createdAt: "2026-11-26T12:22:00-06:00",
    },
  ],
  "77777777-7777-4777-8777-777777777777": [
    {
      id: "act-6",
      label: "Ticket created",
      detail: "Request received and is waiting for an agent.",
      actor: "Alex Morgan",
      createdAt: "2026-11-26T13:06:00-06:00",
    },
  ],
  "88888888-8888-4888-8888-888888888888": [
    {
      id: "act-7",
      label: "Ticket resolved",
      detail: "The projector input board was reseated and tested.",
      actor: "Jordan Lee",
      createdAt: "2026-11-26T08:24:00-06:00",
    },
  ],
};

export const categoryOptions = [
  { value: "HARDWARE", label: "Computer hardware" },
  { value: "NETWORK", label: "Network & connectivity" },
  { value: "SOFTWARE", label: "Software" },
  { value: "ACCOUNTS", label: "Accounts & access" },
  { value: "PERIPHERALS", label: "Printers & peripherals" },
];
