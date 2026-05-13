import type { RankLevel } from '@lineup/shared'

export interface RankPreset {
  name: string
  levels: RankLevel[]
}

export const RANK_PRESETS: RankPreset[] = [
  {
    name: 'Hwal Moo Do',
    levels: [
      { value: 0,  label: 'No belt',       color: '#AAAAAA' },
      { value: 1,  label: 'White',          color: '#DDDDDD' },
      { value: 2,  label: 'Yellow',         color: '#FFDC00' },
      { value: 3,  label: 'Orange',         color: '#FF851B' },
      { value: 4,  label: 'Orange/Green',   color: '#FF851B' },
      { value: 5,  label: 'Green',          color: '#1c9c2b' },
      { value: 6,  label: 'Green/Blue',     color: '#1c9c2b' },
      { value: 7,  label: 'Blue',           color: '#0074D9' },
      { value: 8,  label: 'Blue/Red',       color: '#0074D9' },
      { value: 9,  label: 'Red',            color: '#d41010' },
      { value: 10, label: 'Red/Black',      color: '#d41010' },
      { value: 11, label: 'Black I Dan',    color: '#111111' },
      { value: 12, label: 'Black II Dan',   color: '#111111' },
      { value: 13, label: 'Black III Dan',  color: '#111111' },
      { value: 14, label: 'Master',         color: '#111111' },
    ],
  },
  {
    name: 'BJJ Belts',
    levels: [
      { value: 0, label: 'White',  color: '#E5E7EB' },
      { value: 1, label: 'Blue',   color: '#3B82F6' },
      { value: 2, label: 'Purple', color: '#8B5CF6' },
      { value: 3, label: 'Brown',  color: '#92400E' },
      { value: 4, label: 'Black',  color: '#111111' },
    ],
  },
  {
    name: 'Judo Kyu/Dan',
    levels: [
      { value: 0, label: '6th Kyu (White)',  color: '#E5E7EB' },
      { value: 1, label: '5th Kyu (Yellow)', color: '#FFDC00' },
      { value: 2, label: '4th Kyu (Orange)', color: '#FF851B' },
      { value: 3, label: '3rd Kyu (Green)',  color: '#1c9c2b' },
      { value: 4, label: '2nd Kyu (Blue)',   color: '#0074D9' },
      { value: 5, label: '1st Kyu (Brown)',  color: '#92400E' },
      { value: 6, label: '1st Dan (Black)',  color: '#111111' },
      { value: 7, label: '2nd Dan (Black)',  color: '#111111' },
      { value: 8, label: '3rd Dan (Black)',  color: '#111111' },
    ],
  },
  {
    name: '5-Level Generic',
    levels: [
      { value: 0, label: 'Beginner',     color: '#9CA3AF' },
      { value: 1, label: 'Elementary',   color: '#60A5FA' },
      { value: 2, label: 'Intermediate', color: '#34D399' },
      { value: 3, label: 'Advanced',     color: '#F59E0B' },
      { value: 4, label: 'Expert',       color: '#EF4444' },
    ],
  },
]
