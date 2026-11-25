import type { AppData } from '../domain';
import type { Update } from '../App';
import type { Actions } from '../actions';

export type Props = {
  data: AppData;
  update: Update;
  notify: (message: string) => void;
  actions: Actions;
};
