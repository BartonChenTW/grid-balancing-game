import { test } from 'node:test';
import assert from 'node:assert/strict';

import { escapeHtml, reportCsv, reportHtml } from '../js/report.js';

test('escapeHtml neutralises markup', () => {
  assert.equal(escapeHtml('<script>"x" & \'y\'</script>'), '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;');
});

test('CSV has a header and one row per recorded minute', () => {
  const n = 3;
  const csv = reportCsv({
    until: n - 1,
    groupIds: ['coal', 'solar'],
    demand: [100, 110, 120],
    charging: [0, 5, 0],
    freq: [60, 59.95, 60.01],
    series: [[90, 95, 100], [10, 20, 20]],
  }, (m) => `00:0${m}`);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'time,demand_MW,storage_charging_MW,frequency_Hz,coal_MW,solar_MW');
  assert.equal(lines.length, n + 1);
  assert.equal(lines[2], '00:01,110.0,5.0,59.950,95.0,20.0');
});

test('the HTML report escapes all text and only embeds PNG data images', () => {
  const html = reportHtml({
    lang: 'en',
    title: 'Report <b>',
    subtitle: 'Summer weekday · Taiwan 2025',
    generated: 'Generated today',
    playUrl: 'https://example.org/',
    labels: { setup: 'Setup', score: 'Score', metrics: 'Key numbers', lesson: 'Lesson', chart: 'Chart', freq: 'Frequency', systemCost: 'Cost', events: 'Log', noEvents: 'None' },
    setup: [['Fleet', 'Taiwan <2025>']],
    points: '779 / 1,000 points',
    stars: 2,
    starsLabel: '2 of 3 stars',
    kpis: [{ label: 'Reliability', value: '99.9%', hint: 'no load shedding', score: 100, scoreText: '100/100' }],
    metrics: [['Energy not delivered', '0 MWh']],
    lesson: 'Well balanced & fair',
    systemCost: { total: 'NT$ 141–262 bn per year', note: 'capital' },
    chartPng: 'data:image/png;base64,AAAA',
    freqPng: 'javascript:alert(1)',
    events: [{ time: '09:07', text: '4 × Coal tripped! <x>', note: '' }],
    dataNote: 'See the CSV.',
  });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('Report &lt;b&gt;'));
  assert.ok(html.includes('Taiwan &lt;2025&gt;'));
  assert.ok(html.includes('Well balanced &amp; fair'));
  assert.ok(html.includes('src="data:image/png;base64,AAAA"'));
  assert.ok(!html.includes('javascript:alert'));
  assert.ok(html.includes('★★☆'));
});
