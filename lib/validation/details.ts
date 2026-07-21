import { z } from "zod";

/**
 * Booking details validation. `.strict()` rejects unknown keys (no mass
 * assignment); the three required declarations must be true; own-insurance
 * requires policy details. The 18+ check needs the trip date, so it's done
 * server-side in saveDetails, not here.
 */
export const detailsSchema = z
  .object({
    title: z.string().min(1, "Select a title"),
    firstName: z.string().min(1, "Enter your first name"),
    lastName: z.string().min(1, "Enter your last name"),
    universitySociety: z.string().max(120).default(""),
    studentId: z.string().max(60).default(""),
    dob: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter your date of birth")
      // Reject calendar-impossible dates (e.g. 2010-99-99, 2011-02-30) that the
      // regex alone lets through - otherwise the server age check sees an
      // Invalid Date and NaN < 18 is false, skipping the 18+ gate (audit #4).
      .refine((s) => {
        const [y, m, day] = s.split("-").map(Number);
        const dt = new Date(Date.UTC(y, m - 1, day));
        return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
      }, "Enter a valid date of birth"),
    nationality: z.string().min(1, "Select your nationality"),
    passportNumber: z.string().min(4, "Enter your passport number").max(60),
    phone: z.string().min(5, "Enter your mobile number").max(30),

    emergencyName: z.string().min(1, "Enter an emergency contact name"),
    emergencyRelationship: z.string().max(60).default(""),
    emergencyPhone: z.string().min(5, "Enter an emergency contact number").max(30),

    accessNeeds: z.string().max(2000).default(""),
    marketingOptIn: z.boolean(),

    insuranceChoice: z.enum(["own", "bought"]),
    insurer: z.string().max(120).default(""),
    policyNumber: z.string().max(120).default(""),
    insuranceEmergencyLine: z.string().max(60).default(""),

    shareAccessNeeds: z.boolean(),
    declAge: z.boolean(),
    declFit: z.boolean(),
    declTerms: z.boolean(),
  })
  .strict()
  .refine((d) => d.declAge && d.declFit && d.declTerms, {
    message: "Please confirm the three required declarations.",
    path: ["declTerms"],
  })
  .refine((d) => d.insuranceChoice !== "own" || (d.insurer.trim() && d.policyNumber.trim()), {
    message: "Enter your insurer and policy number.",
    path: ["policyNumber"],
  });

export type DetailsInput = z.input<typeof detailsSchema>;
export type DetailsData = z.output<typeof detailsSchema>;
