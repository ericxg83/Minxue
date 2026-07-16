/**
 * Fix script: re-parse all stored worksheet answers from the "messy" format
 * (multiple question numbers packed into one answer cell) into clean rows.
 */
import('dotenv/config').then(async () => {
  const { query, TABLES, transaction } = await import('./server/config/neon.js');
  const { parseAnswerText, normalizeSectionName } = await import('./server/services/answerParseService.js');

  const worksheetId = '79a723e5-52e7-44f1-8801-bb065c71c474';

  console.log('🔧 Reading current worksheet_answers...');
  const { rows: current } = await query(
    `SELECT id, question_no, answer, answer_type, section, created_at
     FROM ${TABLES.WORKSHEET_ANSWERS}
     WHERE worksheet_id = $1
     ORDER BY section NULLS FIRST, question_no`,
    [worksheetId]
  );

  const cleanRows = [];
  const messyRows = [];
  for (const row of current) {
    const ans = String(row.answer || '').trim();
    const hasSubQno = /\\s\\d{1,3}\\s*[.\\.\\s]\\s*[A-Da-d\\d]/.test(ans.slice(2));
    if (hasSubQno || (ans.length > 15 && /\\d+[\\s\\S]*\\d+/.test(ans) && ans.split(' ').length > 4)) {
      messyRows.push(row);
    } else {
      cleanRows.push(row);
    }
  }

  console.log(`Clean rows: ${cleanRows.length}, messy rows: ${messyRows.length}`);

  if (messyRows.length === 0) {
    console.log('✅ No messy data to fix');
    process.exit(0);
  }

  const newAnswers = [];
  for (const row of messyRows) {
    const text = row.answer;
    const section = normalizeSectionName(row.section);
    const parsed = parseAnswerText(text, [], section);
    for (const a of parsed.answers) {
      newAnswers.push({
        worksheet_id: worksheetId,
        question_no: a.question_no,
        answer: a.answer,
        answer_type: a.answer_type,
        section: a.section
      });
    }
  }

  console.log(`Parsed new answer rows: ${newAnswers.length}`);

  await transaction(async (client) => {
    await client.query(
      `DELETE FROM ${TABLES.WORKSHEET_ANSWERS} WHERE worksheet_id = $1`,
      [worksheetId]
    );

    if (cleanRows.length > 0) {
      const cleanParams = cleanRows.flatMap(r => [r.question_no, r.answer, r.answer_type, r.section]);
      const cleanSQL = `INSERT INTO ${TABLES.WORKSHEET_ANSWERS} (worksheet_id, question_no, answer, answer_type, section) VALUES ` +
        cleanRows.map((_, i) => `($1, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4}, $${i * 4 + 5})`).join(', ');
      await client.query(cleanSQL, [worksheetId, ...cleanParams]);
    }

    if (newAnswers.length > 0) {
      const newParams = newAnswers.flatMap(a => [a.question_no, a.answer, a.answer_type, a.section]);
      const newSQL = `INSERT INTO ${TABLES.WORKSHEET_ANSWERS} (worksheet_id, question_no, answer, answer_type, section) VALUES ` +
        newAnswers.map((_, i) => `($1, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4}, $${i * 4 + 5})`).join(', ') +
        ` ON CONFLICT (worksheet_id, section, question_no) DO UPDATE SET answer = EXCLUDED.answer, answer_type = EXCLUDED.answer_type`;
      await client.query(newSQL, [worksheetId, ...newParams]);
    }
  });

  console.log('✅ Fix complete');

  const { rows: verify } = await query(
    `SELECT section, question_no, answer_type, answer
     FROM ${TABLES.WORKSHEET_ANSWERS}
     WHERE worksheet_id = $1
     ORDER BY section NULLS FIRST, question_no`,
    [worksheetId]
  );

  console.log(`Verification: ${verify.rows.length} rows total`);
  for (const r of verify.rows.slice(0, 20)) {
    console.log(`  ${r.question_no} | ${r.section || ''} | ${r.answer_type} | ${String(r.answer).slice(0, 40)}`);
  }

  process.exit(0);
}).catch(e => {
  console.error('❌ Fix failed:', e);
  process.exit(1);
});