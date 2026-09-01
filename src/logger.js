import {consola} from 'consola';
import {colors} from 'consola/utils';

export const logger = consola.withTag('Alfred Switch');

const modeColors = {
  conflict: colors.red,
  development: colors.yellow,
  'development-interrupted': colors.magenta,
  'foreign-link': colors.red,
  invalid: colors.red,
  missing: colors.red,
  'multiple-releases': colors.red,
  production: colors.green,
  'source-mismatch': colors.red,
};

export const paint = {
  command: value => colors.bold(colors.cyan(value)),
  mode: value => (modeColors[value] ?? colors.white)(value),
  path: colors.cyan,
  value: colors.magenta,
};
