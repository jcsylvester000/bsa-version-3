/**
 * Zod contracts — every request is validated at the boundary. Shared so the UI
 * and the route handler agree on the shape.
 */
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

// Registration accepts a username (or email) + password. A bare username is stored in
// the unique email column as "<username>@local" so it stays a valid unique login key.
export const registerSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(60)
    .regex(/^[a-zA-Z0-9._@+-]+$/, 'Use letters, numbers, and . _ @ + - only'),
  password: z.string().min(6, 'Password must be at least 6 characters').max(200),
});
export type RegisterInput = z.infer<typeof registerSchema>;

// Change password: verify the current one, then set a new one (same rules as register).
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters').max(200),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// PH lat/lon sanity bounds — geo sanity gate at ingestion.
const phLat = z.number().min(4).max(21);
const phLon = z.number().min(116).max(127);

export const outletInputSchema = z.object({
  outletName: z.string().min(1),
  format: z.string().optional(),
  lat: phLat,
  lon: phLon,
  monthlySalesPhp: z.number().nonnegative().optional(),
  performanceTag: z.enum(['hero', 'above', 'avg', 'below', 'problem']).optional(),
});

export const candidateSiteInputSchema = z.object({
  label: z.string().min(1),
  address: z.string().optional(),
  barangay: z.string().optional(),
  city: z.string().optional(),
  lat: phLat,
  lon: phLon,
  siteType: z.string().optional(),
});

// Accept a real UUID or the mock demo run/site ids (mock-* ) so the app is usable
// end-to-end without a database.
const idOrMock = z.string().refine((s) => /^[0-9a-f-]{36}$/i.test(s) || s.startsWith('mock-'), {
  message: 'Must be a UUID or a mock id.',
});

export const territoryGuardRequestSchema = z.object({
  runId: idOrMock,
  /** Optional override of the run's exclusivity radius (metres). */
  exclusivityRadiusM: z.number().int().min(100).max(20_000).optional(),
});
export type TerritoryGuardRequest = z.infer<typeof territoryGuardRequestSchema>;

export const leaseBenchmarkRequestSchema = z.object({
  candidateSiteId: idOrMock,
  /** The corridor to benchmark against (e.g. "BGC", "Ortigas CBD"). */
  corridor: z.string().min(1),
  /** Format defaults to the site_type; may be overridden. */
  format: z.string().min(1),
  mallName: z.string().optional(),
  /** The site's asking terms. Any subset may be supplied; missing terms are skipped. */
  siteTerms: z
    .object({
      baseRentPhpSqm: z.number().positive().optional(),
      escalationPct: z.number().min(0).max(100).optional(),
      cusaPhpSqm: z.number().min(0).optional(),
      leaseTermYears: z.number().int().min(1).max(50).optional(),
      fitoutMonths: z.number().int().min(0).max(48).optional(),
    })
    .refine((t) => Object.values(t).some((v) => v !== undefined), {
      message: 'Provide at least one lease term to benchmark.',
    }),
});
export type LeaseBenchmarkRequest = z.infer<typeof leaseBenchmarkRequestSchema>;

export const VERTICALS = [
  'fnb_qsr', 'fnb_cafe', 'fnb_bakery', 'retail_apparel', 'retail_specialty',
  'services_salon', 'services_spa', 'services_fitness', 'services_laundry',
  'convenience', 'remittance', 'pharmacy', 'diagnostics', 'fuel',
  'automotive', 'hotel', 'education', 'other',
] as const;

export const intakeSubmitSchema = z.object({
  // Existing franchise → franchisorId. Independent operator → `independent` (the API
  // creates a lightweight franchisor keyed on a comparable brand). Exactly one is used.
  franchisorId: z.string().uuid().optional(),
  independent: z
    .object({ name: z.string().min(2), comparableBrand: z.string().min(2) })
    .optional(),
  vertical: z.enum(VERTICALS),
  sections: z.record(z.string(), z.unknown()).default({}),
  outlets: z.array(outletInputSchema).default([]),
  candidateSites: z.array(candidateSiteInputSchema).min(1),
  /// Set when this is an edit-and-rerun → creates a new version linked to the original.
  parentIntakeId: z.string().uuid().optional(),
}).refine((v) => !!v.franchisorId || !!v.independent, {
  message: 'Provide either a franchisorId or independent business details.',
  path: ['franchisorId'],
});
export type IntakeSubmitInput = z.infer<typeof intakeSubmitSchema>;
