/**
 * All 18 administrative regions of the Philippines (PSA, incl. the Negros Island Region re-created by
 * RA 12000, 2024) with a jump-to point at each region's main urban centre. Client-safe and used only
 * for map navigation — place capture works anywhere in the country; the BSA scoring registry
 * (lib/geo/regions.ts) is a separate, smaller list of provinces with loaded reference data.
 */
export interface PhRegion { code: string; name: string; centre: { lat: number; lon: number; label: string } }

export const PH_REGIONS: PhRegion[] = [
  { code: 'NCR', name: 'National Capital Region (Metro Manila)', centre: { lat: 14.5547, lon: 121.0244, label: 'Makati' } },
  { code: 'CAR', name: 'Cordillera Administrative Region (CAR)', centre: { lat: 16.4023, lon: 120.596, label: 'Baguio' } },
  { code: 'I', name: 'Ilocos Region (I)', centre: { lat: 16.6159, lon: 120.3209, label: 'San Fernando, La Union' } },
  { code: 'II', name: 'Cagayan Valley (II)', centre: { lat: 17.6132, lon: 121.727, label: 'Tuguegarao' } },
  { code: 'III', name: 'Central Luzon (III)', centre: { lat: 15.0286, lon: 120.6898, label: 'City of San Fernando, Pampanga' } },
  { code: 'IV-A', name: 'CALABARZON (IV-A)', centre: { lat: 14.2116, lon: 121.1653, label: 'Calamba' } },
  { code: 'MIMAROPA', name: 'MIMAROPA Region', centre: { lat: 13.4115, lon: 121.1803, label: 'Calapan' } },
  { code: 'V', name: 'Bicol Region (V)', centre: { lat: 13.1391, lon: 123.7438, label: 'Legazpi' } },
  { code: 'VI', name: 'Western Visayas (VI)', centre: { lat: 10.7202, lon: 122.5621, label: 'Iloilo City' } },
  { code: 'NIR', name: 'Negros Island Region (NIR)', centre: { lat: 10.6765, lon: 122.9509, label: 'Bacolod' } },
  { code: 'VII', name: 'Central Visayas (VII)', centre: { lat: 10.3157, lon: 123.8854, label: 'Cebu City' } },
  { code: 'VIII', name: 'Eastern Visayas (VIII)', centre: { lat: 11.2443, lon: 125.004, label: 'Tacloban' } },
  { code: 'IX', name: 'Zamboanga Peninsula (IX)', centre: { lat: 6.9214, lon: 122.079, label: 'Zamboanga City' } },
  { code: 'X', name: 'Northern Mindanao (X)', centre: { lat: 8.4542, lon: 124.6319, label: 'Cagayan de Oro' } },
  { code: 'XI', name: 'Davao Region (XI)', centre: { lat: 7.0731, lon: 125.6128, label: 'Davao City' } },
  { code: 'XII', name: 'SOCCSKSARGEN (XII)', centre: { lat: 6.1164, lon: 125.1716, label: 'General Santos' } },
  { code: 'XIII', name: 'Caraga (XIII)', centre: { lat: 8.9475, lon: 125.5406, label: 'Butuan' } },
  { code: 'BARMM', name: 'Bangsamoro (BARMM)', centre: { lat: 7.2236, lon: 124.2464, label: 'Cotabato City' } },
];
