/** Materialises the downloadable CSV templates into public/templates/. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { TEMPLATE_DEFINITIONS, buildTemplate } from '../src/features/imports/templates';

const FILE_NAMES: Record<string, string> = {
  organic: 'organic-summary.csv',
  keywords: 'keywords.csv',
  forms: 'forms.csv',
  landingPages: 'landing-pages.csv',
  trafficTrend: 'traffic-trend.csv',
};

mkdirSync('public/templates', { recursive: true });
for (const definition of TEMPLATE_DEFINITIONS) {
  const name = FILE_NAMES[definition.dataset];
  writeFileSync(`public/templates/${name}`, buildTemplate(definition.dataset), 'utf8');
  console.log(`wrote public/templates/${name}`);
}
