import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'wm_last_idx';

const MESSAGES = [
  'Train hard.',
  'One more session.',
  'Push past yesterday.',
  'Stronger every class.',
  'Every rep counts.',
  'Progress over perfection.',
  'Time to earn it.',
  'Trust your training.',
  'Hold the vision.',
  'Trust the process.',
  'Stay disciplined.',
  'Focus. Train. Repeat.',
  'Show up strong.',
  'Level up today.',
  'Train with purpose.',
  'Keep moving forward.',
];

function pickIndex(exclude: number): number {
  if (MESSAGES.length === 1) return 0;
  let idx: number;
  do {
    idx = Math.floor(Math.random() * MESSAGES.length);
  } while (idx === exclude);
  return idx;
}

export function useWelcomeMessage(): string {
  const [message, setMessage] = useState('');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(val => {
      const lastIdx = val !== null ? parseInt(val, 10) : -1;
      const idx = pickIndex(lastIdx);
      setMessage(MESSAGES[idx]);
      AsyncStorage.setItem(STORAGE_KEY, String(idx));
    });
  }, []);

  return message;
}
