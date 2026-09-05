import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { useTranslations } from '../i18n';

const STORAGE_KEY = 'wm_last_idx';

const MESSAGE_KEYS = [
  'msg1', 'msg2', 'msg3', 'msg4', 'msg5', 'msg6', 'msg7', 'msg8',
  'msg9', 'msg10', 'msg11', 'msg12', 'msg13', 'msg14', 'msg15', 'msg16',
];

function pickIndex(exclude: number): number {
  if (MESSAGE_KEYS.length === 1) return 0;
  let idx: number;
  do {
    idx = Math.floor(Math.random() * MESSAGE_KEYS.length);
  } while (idx === exclude);
  return idx;
}

export function useWelcomeMessage(): string {
  const t = useTranslations('Welcome');
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(val => {
      const lastIdx = val !== null ? parseInt(val, 10) : -1;
      const idx = pickIndex(lastIdx);
      setIndex(idx);
      AsyncStorage.setItem(STORAGE_KEY, String(idx));
    });
  }, []);

  return index === null ? '' : t(MESSAGE_KEYS[index]);
}
