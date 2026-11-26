import type {
  ChecklistSectionDef,
  InspectionReport,
  ItemResponse,
} from '../types/inspection';

export const FORM_DOCUMENTATION_NO = 'IQAF-005';
export const FORM_REVISION_NO = '0';
export const IQAF_BASIS_STATEMENT =
  'Basis: This store inspection checklist and report was prepared using IQAF-005 (Store Inspection Checklist, Rev. 0) as basis.';

export const HOW_TO_FILL_INSTRUCTION =
  'How to fill in: choose Yes, No, or N/A under "Complied?" for every item. For each No, write the deviation and the corrective action. Example: No | Nail polish seen on 2 servers | Servers told to remove it; recheck on next visit.';

export const CHECKLIST_SECTIONS: ChecklistSectionDef[] = [
  {
    code: 'A',
    title: 'Personal Hygiene',
    items: [
      {
        number: 1,
        sectionCode: 'A',
        text: 'Nails are short and trimmed, with no nail polish, false nails, or nail extensions.',
      },
      {
        number: 2,
        sectionCode: 'A',
        text: 'Clean uniform is worn and is used only within the store premises.',
      },
      {
        number: 3,
        sectionCode: 'A',
        text: 'Head cap and hair net are worn throughout service.',
      },
      {
        number: 4,
        sectionCode: 'A',
        text: 'Servers and receptionists with long hair keep it restrained in a neat, tight bun.',
      },
      {
        number: 5,
        sectionCode: 'A',
        text: 'No strong scented perfume or lotion being used.',
      },
      {
        number: 6,
        sectionCode: 'A',
        text: 'Aprons are stored in the designated area before break time.',
      },
      {
        number: 7,
        sectionCode: 'A',
        text: 'No piercings, earrings, rings, watches, or bracelets are worn. Exceptions: plain-band wedding ring (all staff) and watch (receptionist only).',
      },
      {
        number: 8,
        sectionCode: 'A',
        text: 'Personal effects (e.g., e-cigarettes, nail clippers, money, coins) are stored in designated lockers.',
      },
      {
        number: 9,
        sectionCode: 'A',
        text: 'Lockers are clean, secured, and free of rotting food.',
      },
      {
        number: 10,
        sectionCode: 'A',
        text: 'Servers and BOH staff wear no heavy, cakey, or glittered make-up, and no false eyelashes or eyelash extensions.',
      },
    ],
  },
  {
    code: 'B',
    title: 'Handwashing Compliance',
    items: [
      {
        number: 11,
        sectionCode: 'B',
        text: 'Handwashing stations are equipped with hands-free soap dispensers.',
      },
      {
        number: 12,
        sectionCode: 'B',
        text: 'Handwashing stations are accessible and stocked with soap, running water, and single-use paper towels.',
      },
      {
        number: 13,
        sectionCode: 'B',
        text: 'Employees followed the 6-step handwashing method',
      },
      {
        number: 14,
        sectionCode: 'B',
        text: 'Employees wash their hands before preparation and service, after returning from the comfort room or break, and after touching unsanitized surfaces.',
      },
    ],
  },
  {
    code: 'C',
    title: 'Illness Reporting',
    items: [
      {
        number: 15,
        sectionCode: 'C',
        text: 'No staff showing signs of respiratory or gastrointestinal illness are on the floor.',
      },
      {
        number: 16,
        sectionCode: 'C',
        text: 'Employees returning from sick leave presented a valid fit-to-work certificate before handling food',
      },
    ],
  },
  {
    code: 'D',
    title: 'Comfort Rooms',
    items: [
      {
        number: 17,
        sectionCode: 'D',
        text: 'Restrooms are clean.',
      },
      {
        number: 18,
        sectionCode: 'D',
        text: 'Restrooms are stocked with liquid soap, sanitizer, and single-use paper towels.',
      },
    ],
  },
  {
    code: 'E',
    title: 'Sanitation and Cleaning Implements',
    items: [
      {
        number: 19,
        sectionCode: 'E',
        text: 'All cleaning tools are stored in the designated area or cleaning cabinet.',
      },
      {
        number: 20,
        sectionCode: 'E',
        text: 'Food-contact surfaces (FCS) and non-food-contact surfaces (NFCS) are sanitized using the correct chemical.',
      },
    ],
  },
  {
    code: 'F',
    title: 'Equipment and Utensils',
    items: [
      {
        number: 21,
        sectionCode: 'F',
        text: 'Daily cleaning and sanitation record is available and up to date.',
      },
      {
        number: 22,
        sectionCode: 'F',
        text: 'Utensils and equipment are observed to be clean and sanitized before use.',
      },
      {
        number: 23,
        sectionCode: 'F',
        text: 'Metal utensils and equipment are corrosion-resistant (no rust).',
      },
      {
        number: 24,
        sectionCode: 'F',
        text: 'Utensils are free from cracks, chipped edges, and discoloration.',
      },
      {
        number: 25,
        sectionCode: 'F',
        text: 'Operational equipment has undergone preventive maintenance at the required frequency.',
      },
      {
        number: 26,
        sectionCode: 'F',
        text: 'Equipment is calibrated before use, and the calibration schedule is followed.',
      },
    ],
  },
  {
    code: 'G',
    title: 'Thawing and Cold Chain Management',
    items: [
      {
        number: 27,
        sectionCode: 'G',
        text: 'Chest and walk-in freezers are between -18°C and -23°C.',
      },
      {
        number: 28,
        sectionCode: 'G',
        text: 'Vertical refrigerators are between 0°C and 5°C.',
      },
      {
        number: 29,
        sectionCode: 'G',
        text: 'Temperature monitoring log is available and up to date.',
      },
      {
        number: 30,
        sectionCode: 'G',
        text: 'Frozen raw materials are thawed only in the refrigerator or under cold running water; no room-temperature thawing.',
      },
    ],
  },
  {
    code: 'H',
    title: 'Chemicals and Chemical Storage',
    items: [
      {
        number: 31,
        sectionCode: 'H',
        text: 'Chemicals are stored below and away from food and food-contact surfaces.',
      },
      {
        number: 32,
        sectionCode: 'H',
        text: 'Liquid chemicals are stored on lower shelves or in spill trays.',
      },
      {
        number: 33,
        sectionCode: 'H',
        text: "Spray bottles of diluted chemicals are labeled with the chemical's common name and dilution strength.",
      },
      {
        number: 34,
        sectionCode: 'H',
        text: 'Diluted chemicals meet the standard dilution strength.',
      },
      {
        number: 35,
        sectionCode: 'H',
        text: 'A master folder of Safety Data Sheets (SDS) for every chemical on-site is accessible.',
      },
    ],
  },
  {
    code: 'I',
    title: 'Structural and Internal Layout (Facility)',
    items: [
      {
        number: 36,
        sectionCode: 'I',
        text: 'Raw and cooked products are physically separated.',
      },
      {
        number: 37,
        sectionCode: 'I',
        text: 'Walls and floors of processing areas are washable and cleanable.',
      },
      {
        number: 38,
        sectionCode: 'I',
        text: 'No standing water or slippery floors.',
      },
      {
        number: 39,
        sectionCode: 'I',
        text: 'Ceiling and overhead fixtures are free of dirt buildup and condensation.',
      },
      {
        number: 40,
        sectionCode: 'I',
        text: 'Store front and outer walls are maintained, with no graffiti, dirt, debris, or other foreign material.',
      },
    ],
  },
  {
    code: 'J',
    title: 'Drain and Drainage Cover',
    items: [
      {
        number: 41,
        sectionCode: 'J',
        text: 'Wet areas (kitchen) have drains with traps and covers.',
      },
      {
        number: 42,
        sectionCode: 'J',
        text: 'Drain covers (grates) are free from biofilm and in working condition.',
      },
      {
        number: 43,
        sectionCode: 'J',
        text: 'Drains are free-flowing and fitted with traps and grates that block pests and sewer debris.',
      },
    ],
  },
  {
    code: 'K',
    title: 'Pest and Animal Control',
    items: [
      {
        number: 44,
        sectionCode: 'K',
        text: 'Potential entry points on the building exterior are completely sealed.',
      },
      {
        number: 45,
        sectionCode: 'K',
        text: 'Only non-toxic traps (e.g., mechanical and light traps) are used inside the facility.',
      },
      {
        number: 46,
        sectionCode: 'K',
        text: 'Toxic bait stations are secured, tamper-resistant, and placed only on the exterior perimeter.',
      },
      {
        number: 47,
        sectionCode: 'K',
        text: 'No pests or signs of pests (droppings, gnaw marks) in the kitchen and storage areas.',
      },
    ],
  },
  {
    code: 'L',
    title: 'Waste Management',
    items: [
      {
        number: 48,
        sectionCode: 'L',
        text: 'Waste bins are color-coded and clearly labeled for their specific purpose.',
      },
      {
        number: 49,
        sectionCode: 'L',
        text: 'Waste is moved out of food-handling, storage, and dining areas at a defined frequency.',
      },
      {
        number: 50,
        sectionCode: 'L',
        text: 'Waste storage area is physically separated from dining, production, and food-storage zones.',
      },
      {
        number: 51,
        sectionCode: 'L',
        text: 'Waste storage area is well maintained and denies pest harborage.',
      },
      {
        number: 52,
        sectionCode: 'L',
        text: 'Hazardous waste is stored in dedicated, secure, and (where necessary) lockable containers.',
      },
    ],
  },
  {
    code: 'M',
    title: 'Water Supply',
    items: [
      {
        number: 53,
        sectionCode: 'M',
        text: 'Water used as an ingredient or for cleaning food-contact surfaces is potable, with a valid water test result on file.',
      },
    ],
  },
  {
    code: 'N',
    title: 'Storage and Transport',
    items: [
      {
        number: 54,
        sectionCode: 'N',
        text: 'All items are stored at least 15 cm (6 in) off the floor.',
      },
      {
        number: 55,
        sectionCode: 'N',
        text: 'All items are stored at least 45 cm (18 in) away from walls.',
      },
      {
        number: 56,
        sectionCode: 'N',
        text: 'Raw materials, finished goods, allergens, and chemicals are physically separated.',
      },
      {
        number: 57,
        sectionCode: 'N',
        text: 'FEFO and FIFO are implemented in both stores and warehouse.',
      },
      {
        number: 58,
        sectionCode: 'N',
        text: 'Transport vehicles are clean, dedicated to food use, structurally sound, and free from rust.',
      },
    ],
  },
  {
    code: 'O',
    title: 'Flagship Products',
    items: [
      {
        number: 59,
        sectionCode: 'O',
        text: 'Flagship products are prepared using authorized, non-negotiable formula cards.',
      },
      {
        number: 60,
        sectionCode: 'O',
        text: 'Any change in preparation goes through a formal change control process.',
      },
    ],
  },
  {
    code: 'P',
    title: 'Documents and Records',
    items: [
      {
        number: 61,
        sectionCode: 'P',
        text: 'Only authorized, up-to-date documents are used in service.',
      },
      {
        number: 62,
        sectionCode: 'P',
        text: 'Other records are accomplished at the prescribed frequency.',
      },
      {
        number: 63,
        sectionCode: 'P',
        text: 'Records are Attributable, Legible, Contemporaneous, Original, and Accurate (ALCOA).',
      },
    ],
  },
  {
    code: 'Q',
    title: 'Customer Service and Compliance',
    items: [
      {
        number: 64,
        sectionCode: 'Q',
        text: 'A documented procedure for handling customer complaints is in place.',
      },
      {
        number: 65,
        sectionCode: 'Q',
        text: 'Return/refund policies are documented and understood by all employees.',
      },
      {
        number: 66,
        sectionCode: 'Q',
        text: 'Employees have received training in food safety, hygiene, and grievance handling.',
      },
      {
        number: 67,
        sectionCode: 'Q',
        text: 'Emergency contacts and response procedures are clearly posted.',
      },
    ],
  },
];

export const ALL_CHECKLIST_ITEMS = CHECKLIST_SECTIONS.flatMap((s) => s.items);
export const TOTAL_ITEMS_COUNT = ALL_CHECKLIST_ITEMS.length;

export function createEmptyResponse(): ItemResponse {
  return {
    complied: '',
    deviation: '',
    correctiveAction: '',
    photos: [],
  };
}

export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getCurrentTimeString(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function createBlankInspection(): InspectionReport {
  const today = getTodayDateString();
  const responses: Record<number, ItemResponse> = {};
  for (const item of ALL_CHECKLIST_ITEMS) {
    responses[item.number] = createEmptyResponse();
  }

  return {
    id: `insp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    updatedAt: new Date().toISOString(),
    meta: {
      documentationNo: FORM_DOCUMENTATION_NO,
      revisionNo: FORM_REVISION_NO,
      dateOfInspection: today,
      storeLocation: '',
      timeOfInspection: getCurrentTimeString(),
      inspectedBy: '',
    },
    responses,
    signOffs: {
      performedBy: { printedName: '', date: today, signatureDataUrl: null },
      acknowledgedBy: { printedName: '', date: today, signatureDataUrl: null },
      notedBy: { printedName: '', date: today, signatureDataUrl: null },
    },
  };
}

export function createSampleInspection(): InspectionReport {
  const today = getTodayDateString();
  const base = createBlankInspection();
  base.meta = {
    documentationNo: FORM_DOCUMENTATION_NO,
    revisionNo: FORM_REVISION_NO,
    dateOfInspection: today,
    storeLocation: 'Jiang Nan Hotpot — BGC High Street South',
    timeOfInspection: '10:15',
    inspectedBy: 'Maria Elena Santos, QA Officer',
  };

  for (const item of ALL_CHECKLIST_ITEMS) {
    base.responses[item.number] = {
      complied: 'Yes',
      deviation: '',
      correctiveAction: '',
      photos: [],
    };
  }

  base.responses[1] = {
    complied: 'No',
    deviation: 'Nail polish seen on 2 dining servers during pre-opening check.',
    correctiveAction:
      'Servers instructed to remove nail polish immediately; shift supervisor to recheck on next visit.',
    photos: [],
  };
  base.responses[16] = {
    complied: 'N/A',
    deviation: 'No employees returning from sick leave during this inspection period.',
    correctiveAction: '',
    photos: [],
  };
  base.responses[28] = {
    complied: 'No',
    deviation: 'Vertical beverage & garnish chiller #2 recorded at 7.2°C (above 0°C–5°C range).',
    correctiveAction:
      'Door gasket cleaned and thermostat adjusted; maintenance ticket #MT-408 logged and temp re-verified at 4.1°C after 45 mins.',
    photos: [],
  };
  base.responses[33] = {
    complied: 'No',
    deviation: 'One sanitizer spray bottle at dishwashing bay had a faded dilution label.',
    correctiveAction:
      'Replaced bottle label with waterproof print indicating "Quat Sanitizer — 200 ppm" immediately.',
    photos: [],
  };
  base.responses[42] = {
    complied: 'No',
    deviation: 'Minor grease/biofilm accumulation noted along underside of prep-area floor grate.',
    correctiveAction:
      'Grate removed, scrubbed with degreaser, sanitized, and added to nightly deep-clean checklist.',
    photos: [],
  };
  base.responses[58] = {
    complied: 'N/A',
    deviation: 'Store receives deliveries via commissary fleet; no store-owned vehicle on site.',
    correctiveAction: '',
    photos: [],
  };

  base.signOffs = {
    performedBy: {
      printedName: 'Maria Elena Santos',
      date: today,
      signatureDataUrl: null,
    },
    acknowledgedBy: {
      printedName: 'Carlo Mendoza',
      date: today,
      signatureDataUrl: null,
    },
    notedBy: {
      printedName: 'Ramon Villanueva',
      date: today,
      signatureDataUrl: null,
    },
  };

  return base;
}

export function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

export function formatDisplayTime(timeStr: string): string {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return timeStr;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatReportNo(
  storeLocation: string,
  dateOfInspection: string
): string {
  const branch =
    (storeLocation || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toUpperCase() || 'BRANCH NAME';
  const datePart = (dateOfInspection || '').trim() || getTodayDateString();
  return `INSPLND-${branch}-${datePart}`;
}
