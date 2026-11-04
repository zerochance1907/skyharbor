/** The hand-placed ports of the Sundered Sky. Pure data. */
import type { BiomeId } from './biomes';
import type { GoodId } from './goods';

export type PortId =
  | 'skyharbor'
  | 'thistlewick'
  | 'lanternfall'
  | 'rimeholt'
  | 'palespindle'
  | 'cinderquay'
  | 'ashgrove'
  | 'prismhollow'
  | 'veilmere';

export interface PortDef {
  id: PortId;
  name: string;
  biome: BiomeId;
  x: number;
  y: number;
  z: number;
  radius: number;
  /** Direction (radians, world XZ angle via atan2(z, x)) the dock points. */
  dockAngle: number;
  blurb: string;
  keeper: string;
  produces: GoodId[];
  demands: GoodId[];
  landmark: 'lighthouse' | 'windmill' | 'lanterns' | 'icetower' | 'spindle' | 'forge' | 'kiln' | 'prism' | 'veil';
  home?: boolean;
}

export const PORTS: PortDef[] = [
  {
    id: 'skyharbor',
    name: 'Skyharbor',
    biome: 'meadow',
    x: 0,
    y: 120,
    z: 0,
    radius: 150,
    dockAngle: Math.PI / 2,
    blurb: 'Your home berth. The old Cartographers’ Hall still crowns the hill, its dome dark for a year now.',
    keeper: 'Harbormaster Odile Varn',
    produces: ['grain', 'wool', 'tea'],
    demands: ['clockwork', 'iceglass', 'medicine'],
    landmark: 'lighthouse',
    home: true,
  },
  {
    id: 'thistlewick',
    name: 'Thistlewick',
    biome: 'meadow',
    x: -1650,
    y: 150,
    z: 700,
    radius: 110,
    dockAngle: 0.3,
    blurb: 'A cheerful orchard town where every roof has a beehive.',
    keeper: 'Quartermaster Pell Harrow',
    produces: ['grain', 'tea', 'timber'],
    demands: ['spice', 'lanternoil', 'emberite'],
    landmark: 'windmill',
  },
  {
    id: 'lanternfall',
    name: 'Lanternfall',
    biome: 'meadow',
    x: -2950,
    y: 210,
    z: -900,
    radius: 125,
    dockAngle: -0.6,
    blurb: 'A cascade town strung with a thousand paper lanterns over its falls.',
    keeper: 'Lamplighter Suvi Okonma',
    produces: ['lanternoil', 'silk', 'timber'],
    demands: ['grain', 'aether', 'furs'],
    landmark: 'lanterns',
  },
  {
    id: 'rimeholt',
    name: 'Rimeholt',
    biome: 'frost',
    x: 350,
    y: 260,
    z: -2650,
    radius: 120,
    dockAngle: Math.PI / 2 + 0.4,
    blurb: 'An ice-quarry fortress where the wind sings through hollow towers.',
    keeper: 'Warden Brann Iselgard',
    produces: ['iceglass', 'furs'],
    demands: ['tea', 'grain', 'lanternoil', 'medicine'],
    landmark: 'icetower',
  },
  {
    id: 'palespindle',
    name: 'Pale Spindle',
    biome: 'frost',
    x: -1250,
    y: 330,
    z: -4250,
    radius: 100,
    dockAngle: 1.2,
    blurb: 'A monastery coiled around a single needle of ancient ice.',
    keeper: 'Sister Amaranth Coil',
    produces: ['medicine', 'iceglass', 'furs'],
    demands: ['spice', 'silk', 'clockwork'],
    landmark: 'spindle',
  },
  {
    id: 'cinderquay',
    name: 'Cinderquay',
    biome: 'ember',
    x: 2650,
    y: 170,
    z: 300,
    radius: 120,
    dockAngle: Math.PI - 0.2,
    blurb: 'Forges roar day and night along the black-glass quays.',
    keeper: 'Forgemaster Dace Hollin',
    produces: ['emberite', 'clockwork'],
    demands: ['timber', 'grain', 'wool'],
    landmark: 'forge',
  },
  {
    id: 'ashgrove',
    name: 'Ashgrove Anchorage',
    biome: 'ember',
    x: 4350,
    y: 230,
    z: -1350,
    radius: 105,
    dockAngle: Math.PI + 0.6,
    blurb: 'A smugglers’ hold built into a cold caldera. Ask no questions.',
    keeper: 'Broker Inès Marrow',
    produces: ['spice', 'emberite', 'clockwork'],
    demands: ['medicine', 'furs', 'tea'],
    landmark: 'kiln',
  },
  {
    id: 'prismhollow',
    name: 'Prismhollow',
    biome: 'crystal',
    x: 900,
    y: 190,
    z: 2850,
    radius: 115,
    dockAngle: -Math.PI / 2 - 0.3,
    blurb: 'Glass-cutters’ terraces that ring like bells at dawn.',
    keeper: 'Lens-Wright Tamsin Oru',
    produces: ['aether', 'silk'],
    demands: ['clockwork', 'timber', 'wool'],
    landmark: 'prism',
  },
  {
    id: 'veilmere',
    name: 'Veilmere',
    biome: 'crystal',
    x: -1550,
    y: 250,
    z: 4350,
    radius: 110,
    dockAngle: -0.9,
    blurb: 'A scholar-port beneath shimmering curtains of aether light.',
    keeper: 'Archivist Rook Lindqvist',
    produces: ['aether', 'medicine', 'spice'],
    demands: ['iceglass', 'emberite', 'lanternoil'],
    landmark: 'veil',
  },
];

export const PORT_BY_ID: Record<PortId, PortDef> = Object.fromEntries(PORTS.map((p) => [p.id, p])) as Record<
  PortId,
  PortDef
>;

/** World-space berth: where the ship parks when docked, just off the dock end. */
export function berthPosition(p: PortDef): { x: number; y: number; z: number; heading: number } {
  const d = p.radius + 42;
  const x = p.x + Math.cos(p.dockAngle) * d;
  const z = p.z + Math.sin(p.dockAngle) * d;
  // Ship heading so the ship's side faces the dock (moored broadside).
  const outward = Math.atan2(Math.sin(p.dockAngle), Math.cos(p.dockAngle));
  // forward vector = (-sin h, -cos h); want forward perpendicular to outward.
  const heading = -outward;
  return { x, y: p.y + 6, z, heading };
}

/** Point where a ship should approach to dock (further out along the pier). */
export function approachPosition(p: PortDef): { x: number; y: number; z: number } {
  const d = p.radius + 120;
  return { x: p.x + Math.cos(p.dockAngle) * d, y: p.y + 10, z: p.z + Math.sin(p.dockAngle) * d };
}

/** Story landmarks that are not ports. */
export interface LandmarkDef {
  id: string;
  name: string;
  biome: BiomeId;
  x: number;
  y: number;
  z: number;
  radius: number;
  kind: 'ruin' | 'finale' | 'wreck';
}

export const LANDMARKS: LandmarkDef[] = [
  { id: 'observatory', name: 'The Drowned Observatory', biome: 'frost', x: -4300, y: 280, z: -3150, radius: 95, kind: 'ruin' },
  { id: 'meridian', name: 'The Hollow Meridian', biome: 'crystal', x: 5200, y: 420, z: 4700, radius: 170, kind: 'finale' },
  { id: 'wreck_courier', name: 'Wreck of the Quill', biome: 'meadow', x: -2200, y: 130, z: -1500, radius: 60, kind: 'wreck' },
  { id: 'cinder_vault', name: 'The Cinder Vault', biome: 'ember', x: 3600, y: 160, z: 1800, radius: 80, kind: 'ruin' },
];

export const LANDMARK_BY_ID: Record<string, LandmarkDef> = Object.fromEntries(LANDMARKS.map((l) => [l.id, l]));
