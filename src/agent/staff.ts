// Corvale Health's pharmacy staff (fictional, like the hospitals). The demo sign-in on the memo picks one of
// these people and checks their demo PIN; a hospital would get the same name and role from single sign-on.
// The PINs are not secrets: they are printed on the page next to each name, because this is a demo login.
// Only pharmacists and the director can approve a decision; a buyer can sign in, read and draft, and is refused.

export type StaffRole = "pharmacist" | "director" | "buyer";

export interface StaffMember {
  id: string;
  /** Name and credential, as it is signed and stored in H-MEM. */
  name: string;
  role: StaffRole;
  title: string;
  /** Demo PIN, shown on the sign-in card. */
  demoPin: string;
}

export const STAFF: StaffMember[] = [
  { id: "jhale", name: "Jordan Hale, PharmD", role: "pharmacist", title: "Clinical pharmacist, oncology", demoPin: "2417" },
  { id: "rbrooks", name: "Riley Brooks, PharmD", role: "pharmacist", title: "Pharmacy purchasing lead", demoPin: "3088" },
  { id: "amorgan", name: "Alex Morgan, PharmD", role: "pharmacist", title: "Emergency department pharmacist", demoPin: "5162" },
  { id: "treyes", name: "Taylor Reyes, PharmD", role: "director", title: "Director of Pharmacy", demoPin: "7240" },
  { id: "jpark", name: "Jamie Park", role: "buyer", title: "Pharmacy buyer (cannot approve)", demoPin: "1093" },
];

export const APPROVER_ROLES: StaffRole[] = ["pharmacist", "director"];

export const canApprove = (role: string | undefined): boolean => APPROVER_ROLES.includes(role as StaffRole);

export const staffById = (id: string): StaffMember | undefined => STAFF.find((s) => s.id === id);
