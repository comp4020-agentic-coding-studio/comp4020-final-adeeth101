// Original performers: rounded figures with a face and arms. The role is told
// by an accessory and a label as well as by colour, so it reads in greyscale:
// beats wear headphones, bass a visor, melody a crest, texture a halo, and
// custom parts a small star badge.
import type {Role} from '../shared/presets.ts';
export type Look=Role|'custom';
export const ROLE_COLOR:Record<Look,string>={beats:'var(--apricot)',bass:'var(--lavender)',melody:'var(--sky)',texture:'var(--mint-soft)',custom:'var(--sand)'};
const ACCESSORY:Record<Look,string>={
  beats:'<path d="M26 40 Q50 8 74 40" fill="none" stroke="var(--ink)" stroke-width="5" stroke-linecap="round"/><rect x="18" y="36" width="12" height="18" rx="5" fill="var(--ink)"/><rect x="70" y="36" width="12" height="18" rx="5" fill="var(--ink)"/>',
  bass:'<rect x="28" y="36" width="44" height="12" rx="6" fill="var(--ink)"/><rect x="34" y="39" width="32" height="5" rx="2.5" fill="var(--accent)" opacity="0.85"/>',
  melody:'<path d="M38 22 L44 8 L50 20 L56 6 L62 22 Z" fill="var(--ink)"/>',
  texture:'<ellipse cx="50" cy="13" rx="20" ry="5" fill="none" stroke="var(--ink)" stroke-width="4"/>',
  custom:'<path d="M50 6 l4 8 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1z" fill="var(--ink)"/>',
};
// Faces vary by a seed so two performers in the same role are still distinct.
export function performerSvg(look:Look,seed:string){
  let h=0;for(const c of seed)h=(h*31+c.charCodeAt(0))>>>0;
  // Keep high-bit hashes unsigned: a negative array index drops the shape.
  const eye=h%3,mouth=(h>>>3)%3,body=(h>>>6)%3;
  const eyes=['<circle cx="42" cy="44" r="3.4"/><circle cx="58" cy="44" r="3.4"/>','<path d="M38 44 q4 -4 8 0 M54 44 q4 -4 8 0" fill="none" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>','<rect x="39" y="41" width="6" height="6" rx="2"/><rect x="55" y="41" width="6" height="6" rx="2"/>'][eye];
  const mouths=['<path d="M43 55 q7 6 14 0" fill="none" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>','<ellipse cx="50" cy="56" rx="4" ry="3"/>','<path d="M44 56 h12" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>'][mouth];
  const torso=['<rect x="30" y="66" width="40" height="42" rx="18"/>','<path d="M28 108 Q50 56 72 108 Z"/>','<rect x="32" y="66" width="36" height="42" rx="10"/>'][body];
  return `<svg class="figure" viewBox="0 0 100 120" aria-hidden="true" focusable="false"><g class="body" fill="${ROLE_COLOR[look]}">${torso}<rect class="arm arm-l" x="16" y="72" width="12" height="30" rx="6"/><rect class="arm arm-r" x="72" y="72" width="12" height="30" rx="6"/><circle cx="50" cy="46" r="24"/></g><g class="face" fill="var(--ink)">${eyes}${mouths}</g><g class="accessory">${ACCESSORY[look]}</g></svg>`;
}
