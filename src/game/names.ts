import type { SectorId } from '../config/sectors';
import type { Rng } from './rng';

/** Brand-like roots shared across sectors. */
const ROOTS = [
  'Aldren', 'Ambrose', 'Arcadia', 'Ardent', 'Ashby', 'Aurel', 'Avalon', 'Axion', 'Bastion', 'Beacon', 'Belmont', 'Birchwood',
  'Blackthorn', 'Bluewater', 'Bramble', 'Brightline', 'Brookfield', 'Calder', 'Cambrian', 'Carrow', 'Castell', 'Cedar', 'Cinder',
  'Clearwater', 'Cobalt', 'Coldstream', 'Copperleaf', 'Corvid', 'Crestline', 'Dalton', 'Delmar', 'Driftwood', 'Dunmore', 'Eastgate',
  'Elmstead', 'Emberly', 'Everline', 'Fairhaven', 'Falcon', 'Fenwick', 'Fernhill', 'Foxglove', 'Galen', 'Garnet', 'Glenmore',
  'Granite', 'Greystone', 'Halvorsen', 'Harbour', 'Hartwell', 'Hawthorne', 'Helix', 'Highmark', 'Holloway', 'Ironwood', 'Juniper',
  'Kestrel', 'Kingsley', 'Lakeshore', 'Larkspur', 'Lindqvist', 'Lodestar', 'Lumen', 'Marlow', 'Meridian', 'Millbrook', 'Monarch',
  'Northgate', 'Norwood', 'Oakhurst', 'Obsidian', 'Orchard', 'Osprey', 'Paragon', 'Pembroke', 'Pinnacle', 'Quarry', 'Quillon',
  'Radcliffe', 'Ravenna', 'Redfern', 'Ridgeway', 'Riverton', 'Rowan', 'Saffron', 'Sable', 'Sterling', 'Stonebridge', 'Summit',
  'Tamsin', 'Tarrant', 'Thornbury', 'Trident', 'Tidewater', 'Umber', 'Valemont', 'Vantage', 'Verity', 'Westbrook', 'Whitcombe',
  'Wildmere', 'Windham', 'Wrenfield', 'Yardley', 'Zephyr', 'Halcyon', 'Calloway', 'Ostrander', 'Penrose', 'Selwyn', 'Thackeray',
];

const TECH_ROOTS = [
  'Nexora', 'Quantis', 'Veridian', 'Synthos', 'Cortexa', 'Lumora', 'Arctura', 'Vectra', 'Opticore', 'Datavine', 'Cloudreach',
  'Kernelworks', 'Bitforge', 'Stratus', 'Novalink', 'Zentrix', 'Parallax', 'Syntra', 'Corelight', 'Ionix', 'Fluxion', 'Heliox',
  'Altamira', 'Cipheron', 'Graphene', 'Netrix', 'Omnisys', 'Pixelon', 'Qubit', 'Signalis', 'Tensora', 'Vertexa', 'Xylo', 'Logicon',
];

const BIO_ROOTS = [
  'Genova', 'Biolis', 'Celtara', 'Medica', 'Theron', 'Vitalis', 'Amplora', 'Curexis', 'Immuna', 'Neurova', 'Oncora', 'Proteus',
  'Renalis', 'Sanova', 'Thera', 'Viralux', 'Zymera', 'Cardion', 'Dermagen', 'Hepatix', 'Lyntra', 'Myelon', 'Osteon', 'Pulmora',
];

const SUFFIX: Record<SectorId, string[]> = {
  tech: ['Software', 'Systems', 'Technologies', 'Networks', 'Digital', 'Labs', 'Cloud', 'Security', 'Analytics'],
  semis: ['Semiconductor', 'Microsystems', 'Silicon', 'Devices', 'Photonics', 'Circuits', 'Instruments'],
  health: ['Health', 'Medical', 'Diagnostics', 'Care', 'Surgical', 'Health Partners', 'Life Sciences'],
  pharma: ['Therapeutics', 'Pharmaceuticals', 'Biosciences', 'Biologics', 'Pharma', 'Genomics'],
  financials: ['Bancorp', 'Financial', 'Capital', 'Trust', 'Holdings', 'Payments', 'Insurance Group', 'Securities'],
  discretionary: ['Motors', 'Brands', 'Leisure', 'Home', 'Outfitters', 'Hospitality', 'Living', 'Apparel'],
  staples: ['Foods', 'Beverages', 'Consumer', 'Provisions', 'Household', 'Farms', 'Brewing'],
  industrials: ['Industries', 'Engineering', 'Machinery', 'Dynamics', 'Manufacturing', 'Controls', 'Works'],
  energy: ['Energy', 'Petroleum', 'Oil & Gas', 'Resources', 'Drilling', 'Pipelines', 'Refining'],
  utilities: ['Power', 'Electric', 'Utilities', 'Water', 'Gas & Light', 'Grid'],
  telecom: ['Telecom', 'Communications', 'Wireless', 'Broadband', 'Connect', 'Towers'],
  realestate: ['Realty', 'Properties', 'REIT', 'Estates', 'Land Trust', 'Property Group'],
  materials: ['Materials', 'Chemicals', 'Mining', 'Metals', 'Steel', 'Minerals', 'Packaging'],
  transport: ['Airways', 'Rail', 'Logistics', 'Freight', 'Shipping', 'Transport', 'Air'],
  renewables: ['Solar', 'Renewables', 'Wind', 'Clean Energy', 'Storage', 'Hydrogen', 'Power Systems'],
  aerospace: ['Aerospace', 'Defence', 'Aviation', 'Space', 'Avionics', 'Orbital'],
  entertainment: ['Media', 'Studios', 'Entertainment', 'Interactive', 'Pictures', 'Games', 'Live'],
  retail: ['Retail', 'Stores', 'Market', 'Mart', 'Commerce', 'Goods', 'Outlet'],
};

export function companyName(rng: Rng, sector: SectorId, used: Set<string>): string {
  for (let attempt = 0; attempt < 200; attempt++) {
    let root: string;
    if ((sector === 'tech' || sector === 'semis') && rng.chance(0.6)) root = rng.pick(TECH_ROOTS);
    else if ((sector === 'pharma' || sector === 'health') && rng.chance(0.55)) root = rng.pick(BIO_ROOTS);
    else root = rng.pick(ROOTS);
    const name = `${root} ${rng.pick(SUFFIX[sector])}`;
    const key = root;
    if (!used.has(key) && !used.has(name)) {
      used.add(key);
      used.add(name);
      return name;
    }
  }
  // fallback: compound name
  const name = `${rng.pick(ROOTS)}-${rng.pick(ROOTS)} ${rng.pick(SUFFIX[sector])}`;
  used.add(name);
  return name;
}

/** Derive a 2-4 letter ticker from a company name, guaranteed unique. */
export function makeTicker(name: string, used: Set<string>, rng: Rng): string {
  const words = name.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean);
  const first = words[0].toUpperCase();
  const second = (words[1] ?? '').toUpperCase();
  const candidates = [
    first.slice(0, 4),
    first.slice(0, 3) + (second[0] ?? ''),
    first.slice(0, 3),
    first[0] + first.slice(2, 4),
    first.slice(0, 2) + (second[0] ?? '') + (second[1] ?? ''),
    first[0] + (second.slice(0, 3) || first.slice(1, 4)),
    first.slice(0, 2) + first[first.length - 1],
  ];
  for (const c of candidates) {
    if (c.length >= 2 && !used.has(c)) {
      used.add(c);
      return c;
    }
  }
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < 500; i++) {
    const c = first.slice(0, 2) + letters[rng.int(0, 25)] + (rng.chance(0.5) ? letters[rng.int(0, 25)] : '');
    if (!used.has(c)) {
      used.add(c);
      return c;
    }
  }
  throw new Error('ticker space exhausted');
}

export const FIRST_NAMES = [
  'Adaeze', 'Aiden', 'Alejandro', 'Amara', 'Anika', 'Arjun', 'Astrid', 'Beatriz', 'Benedict', 'Caius', 'Camille', 'Chen', 'Clara',
  'Dmitri', 'Elena', 'Elias', 'Esme', 'Farah', 'Felix', 'Freya', 'Gabriel', 'Hana', 'Henrik', 'Imogen', 'Isaac', 'Jasper', 'Jun',
  'Kai', 'Kamala', 'Leila', 'Lorenzo', 'Lucia', 'Magnus', 'Malik', 'Marguerite', 'Mateo', 'Mei', 'Nadia', 'Nikolai', 'Noor',
  'Oliver', 'Olusegun', 'Orla', 'Pascal', 'Priya', 'Quentin', 'Rafael', 'Rania', 'Rohan', 'Saoirse', 'Sebastian', 'Selin', 'Soren',
  'Tariq', 'Thea', 'Tobias', 'Valentina', 'Wen', 'Xavier', 'Yara', 'Yusuf', 'Zara', 'Ines', 'Marcus', 'Helena', 'Theo', 'Ingrid',
  'Callum', 'Rosalind', 'Desmond', 'Anouk', 'Bastian', 'Cordelia', 'Emeka', 'Fiona', 'Gideon', 'Hiroshi', 'Ilse', 'Joaquin',
];

export const LAST_NAMES = [
  'Abernathy', 'Adeyemi', 'Albrecht', 'Ashworth', 'Bancroft', 'Bergström', 'Bhattacharya', 'Calloway', 'Castellanos', 'Chowdhury',
  'Delacroix', 'Donnelly', 'Eriksen', 'Fairbanks', 'Fitzgerald', 'Galloway', 'Gonzaga', 'Hargreaves', 'Hayashi', 'Holmqvist',
  'Ibsen', 'Iyer', 'Jansen', 'Kaminski', 'Kowalczyk', 'Lachance', 'Lindqvist', 'Mbeki', 'Montague', 'Nakamura', 'Novak',
  'Okonkwo', 'Ortega', 'Pemberton', 'Petrov', 'Quintero', 'Ramaswamy', 'Rothschild', 'Salazar', 'Sorensen', 'Takeda', 'Thornton',
  'Underwood', 'Vasquez', 'Varga', 'Wainwright', 'Whitaker', 'Xu', 'Yamamoto', 'Zielinski', 'Achterberg', 'Beaumont', 'Carvalho',
  'Dufresne', 'Esposito', 'Falkenberg', 'Grünewald', 'Hollister', 'Kensington', 'Moreau', 'Oyelaran', 'Prescott', 'Strand',
];

export function personName(rng: Rng): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

const PLACES = ['Ashford', 'Bellhaven', 'Corran', 'Dunleigh', 'Easterly', 'Fairmont', 'Glenhurst', 'Harrowgate', 'Kingsbridge',
  'Lowmoor', 'Marchmont', 'Newhaven', 'Oldcastle', 'Portwen', 'Queensmere', 'Rosedale', 'Southwold', 'Thistlebury', 'Westmere', 'Larchfield'];

export function institutionName(rng: Rng, type: string): string {
  const place = rng.pick(PLACES);
  const ln = rng.pick(LAST_NAMES);
  switch (type) {
    case 'hnw':
      return personName(rng);
    case 'family':
      return rng.pick([`${ln} Family Office`, `${ln} & Sons Private Office`, `The ${ln} Trust`, `${ln} Heritage Partners`]);
    case 'pension':
      return rng.pick([`${place} Teachers' Pension`, `${place} Municipal Retirement Fund`, `${place} Health Workers Pension`, `${place} Transit Employees' Pension`, `${place} Civil Service Scheme`]);
    case 'institution':
      return rng.pick([`${place} University Endowment`, `${place} Charitable Foundation`, `${ln} Insurance Reserve`, `${place} Sovereign Reserve`, `${ln} Foundation`]);
    case 'corporate':
      return rng.pick([`${rng.pick(ROOTS)} Treasury Investments`, `${rng.pick(ROOTS)} Group Strategic Reserve`, `${rng.pick(ROOTS)} Holdings Treasury`]);
    default:
      return personName(rng);
  }
}
