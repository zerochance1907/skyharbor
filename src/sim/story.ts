/**
 * The main questline: the vanished Cartographers' Guild. Eight steps from the
 * dark dome of Skyharbor to the eye of the storm at the Hollow Meridian.
 */
import { LANDMARK_BY_ID, PORT_BY_ID, berthPosition, type PortId } from './ports';

export interface StoryState {
  step: number;
  complete: boolean;
  flags: Record<string, boolean>;
}

export type StoryObjective =
  | { type: 'dock'; port: PortId }
  | { type: 'reach'; landmark: string; radius: number }
  | { type: 'fragments'; count: number }
  | { type: 'flagship' };

export interface StoryStep {
  title: string;
  objective: StoryObjective;
  summary: string;
  /** Dialogue shown when the step is completed. */
  outro: { speaker: string; lines: string[] };
  reward?: number;
}

export interface Fragment {
  id: string;
  x: number;
  y: number;
  z: number;
}

export const FRAGMENTS: Fragment[] = [
  { id: 'rose-1', x: -600, y: 200, z: -700 },
  { id: 'rose-2', x: 820, y: 170, z: 880 },
  { id: 'rose-3', x: -1900, y: 270, z: -300 },
  { id: 'rose-4', x: 1500, y: 300, z: -1500 },
  { id: 'rose-5', x: -700, y: 350, z: 2000 },
  { id: 'rose-6', x: 2100, y: 230, z: 2100 },
  { id: 'rose-7', x: -3500, y: 300, z: 600 },
  { id: 'rose-8', x: 3200, y: 270, z: -500 },
  { id: 'rose-9', x: -300, y: 420, z: -3600 },
  { id: 'rose-10', x: -3600, y: 380, z: 3000 },
  { id: 'rose-11', x: 4800, y: 300, z: 600 },
  { id: 'rose-12', x: 2600, y: 360, z: 4200 },
];

export const FRAGMENTS_NEEDED = 4;

export const STORY: StoryStep[] = [
  {
    title: 'The Dark Dome',
    objective: { type: 'dock', port: 'skyharbor' },
    summary: 'Bring your ship into the Skyharbor docks. The harbormaster has asked to see you.',
    outro: {
      speaker: 'Harbormaster Odile Varn',
      lines: [
        'There you are. You’ve your mother’s knack for landing crooked.',
        'A year ago tonight the Cartographers’ Guild went dark. Every chart-wright, every apprentice. The Hall up on the hill hasn’t lit its dome since.',
        'Their courier, the Quill, left for Lanternfall the night they vanished. Never arrived. A fisher spotted wreckage drifting north-east of the Lanternfall falls.',
        'You’ve a ship and nothing to lose. Find the Quill. Find out what the Guild was chasing.',
      ],
    },
  },
  {
    title: 'The Last Courier',
    objective: { type: 'reach', landmark: 'wreck_courier', radius: 140 },
    summary: 'Search for the wreck of the Guild courier Quill, north-west of Skyharbor on the way to Lanternfall.',
    outro: {
      speaker: 'Guild Logbook',
      lines: [
        'The wreck is cold, its envelope torn on a reef of floating stone. Lashed inside the chart-case: the Guild’s logbook, swollen with cloud-damp.',
        '“Day 212. The Rose is broken into twelve and scattered, as agreed. Only together do they show the way to the Meridian. Deliver the first word to the Lamplighter at Lanternfall.”',
      ],
    },
    reward: 150,
  },
  {
    title: 'The Lamplighter',
    objective: { type: 'dock', port: 'lanternfall' },
    summary: 'Carry the Guild logbook to the Lamplighter at Lanternfall, far to the west.',
    outro: {
      speaker: 'Lamplighter Suvi Okonma',
      lines: [
        'The Quill’s logbook… oh, Maren. She always did write in that awful hand.',
        'The Guild found something past the storms in the south-east — a place where the sky folds back on itself. They called it the Hollow Meridian.',
        'They feared the Gullwake Corsairs would follow them, so they broke their master chart, the Compass Rose, into twelve shards and hid them across the sky.',
        'Gather four and the old Drowned Observatory will show itself on your charts. Shards glow like stars — look for their pillars of light.',
      ],
    },
    reward: 200,
  },
  {
    title: 'Shards of the Rose',
    objective: { type: 'fragments', count: FRAGMENTS_NEEDED },
    summary: 'Collect compass-rose shards. Each shard glows with a pillar of light and charts the sky around it.',
    outro: {
      speaker: 'The Compass Rose',
      lines: [
        'As the fourth shard clicks into place the pieces warm in your hands. Faint lines of light crawl across your chart…',
        '…and settle on a ruin far in the frozen north-west: the Drowned Observatory, where the Guild first watched the Meridian.',
      ],
    },
    reward: 300,
  },
  {
    title: 'The Drowned Observatory',
    objective: { type: 'reach', landmark: 'observatory', radius: 170 },
    summary: 'Fly to the Drowned Observatory in the frozen north-west and search the ruin.',
    outro: {
      speaker: 'Observatory Inscription',
      lines: [
        'Under frost-split columns the great telescope still points south-east. Its lens is gone — only an empty brass cradle remains.',
        'Scratched into the plinth: “To pass the storm-wall, true the Aether Lens at Veilmere.”',
        'A horn sounds behind you. Black-sailed ships rise from the clouds: the Gullwake Corsairs. Their flagship carries a glint of glass at its prow…',
      ],
    },
    reward: 250,
  },
  {
    title: 'The Corsair’s Toll',
    objective: { type: 'flagship' },
    summary: 'Sink the Gullwake flagship, the Black Gannet, and recover the stolen Aether Lens. Repair at a port if you need to.',
    outro: {
      speaker: 'Captain Ysolde Crane',
      lines: [
        '“You’ve no idea what you’re chasing, chart-brat,” the corsair captain shouts as her ship lists into the clouds.',
        'From the wreckage you haul up a velvet case. Inside, a lens of flawless aether glass hums softly against your palm.',
      ],
    },
    reward: 500,
  },
  {
    title: 'Lens of Veilmere',
    objective: { type: 'dock', port: 'veilmere' },
    summary: 'Bring the Aether Lens to the Archivist at Veilmere, in the far south of the Crystal Reefs.',
    outro: {
      speaker: 'Archivist Rook Lindqvist',
      lines: [
        'The Lens of the Guild. I polished this once, as a boy, and was scolded for leaving prints.',
        'There. Trued to the reef-song. Mount it at your bow and the storm-wall will part for you — a little.',
        'The Meridian lies south-east, past Prismhollow, inside a storm that has not stopped in a hundred years. Bring them home.',
      ],
    },
    reward: 300,
  },
  {
    title: 'The Hollow Meridian',
    objective: { type: 'reach', landmark: 'meridian', radius: 130 },
    summary: 'Pierce the storm-wall in the far south-east and reach the eye of the Hollow Meridian.',
    outro: {
      speaker: 'Guildmaster Maren Halloway',
      lines: [
        'The storm falls silent. Inside the ring of stone the air is still and gold, and the Guild is here — all of them, frozen mid-step around a chart table, as if a single breath had lasted a year.',
        'The Lens flares. Time lurches forward. A woman in a salt-stained coat blinks at you. “Did… did we make it?”',
        '“The Meridian is the edge of the charted sky. We stepped through to see what lies beyond, and the sky held us. You brought the Lens. You brought us home.”',
        'That night, for the first time in a year, the dome of the Cartographers’ Hall burns bright over Skyharbor. The sky is yours to chart.',
      ],
    },
    reward: 5000,
  },
];

export function newStory(): StoryState {
  return { step: 0, complete: false, flags: {} };
}

export type StoryEvent =
  | { type: 'dock'; port: PortId }
  | { type: 'reach'; landmark: string }
  | { type: 'fragment'; total: number }
  | { type: 'flagship' };

/** Advance the story if `ev` satisfies the current objective. Returns the completed step or null. */
export function advanceStory(s: StoryState, ev: StoryEvent): StoryStep | null {
  if (s.complete) return null;
  const step = STORY[s.step];
  const o = step.objective;
  let done = false;
  if (o.type === 'dock' && ev.type === 'dock') done = ev.port === o.port;
  else if (o.type === 'reach' && ev.type === 'reach') done = ev.landmark === o.landmark;
  else if (o.type === 'fragments' && ev.type === 'fragment') done = ev.total >= o.count;
  else if (o.type === 'flagship' && ev.type === 'flagship') done = true;
  if (!done) return null;
  s.step++;
  if (s.step >= STORY.length) {
    s.complete = true;
    s.step = STORY.length - 1;
  }
  return step;
}

/** World position of the current objective for HUD markers, if any. */
export function objectiveTarget(s: StoryState): { x: number; y: number; z: number; name: string } | null {
  if (s.complete) return null;
  const o = STORY[s.step].objective;
  if (o.type === 'dock') {
    const p = PORT_BY_ID[o.port];
    const b = berthPosition(p);
    return { x: b.x, y: b.y, z: b.z, name: `${p.name} docks` };
  }
  if (o.type === 'reach') {
    const l = LANDMARK_BY_ID[o.landmark];
    return { x: l.x, y: l.y, z: l.z, name: l.name };
  }
  return null;
}
