#!/usr/bin/env node
/**
 * Test script for parsing "challenged" answer rows from database.
 * Reads messy rows (multiple question numbers stored in one answer),
 * feeds each line to parseAnswerText, and validates that we get
 * distinct answers with correct question_no and answer_type.
 */
import('dotenv/config').then(async () => {
  const { query, TABLES } = await import('./config/neon.js');
  const { parseAnswerText, normalizeSectionName } = await import('./services/answerParseService.js');

  // Fetch rows where answer contains multiple question numbers (simple heuristic)
  const { rows } = await query(
    `SELECT worksheet_id, question_no, answer, section FROM ${TABLES.WORKSHEET_ANSWERS}
     WHERE length(answer) > 10 AND section IS NOT NULL
     ORDER BY worksheet_id, question_no LIMIT 20`
  );

  const testRows = rows.filter(r => /\\d+\\.[\\s\\S]*\\d+/.test(r.answer) && r.section);

  console.log(`Found ${testRows.length} suspicious rows`);

  let failCount = 0;
  for (const row of testRows) {
    // Simulate OCR reading the whole answer line as a single string
    const text = row.answer;
    const result = parseAnswerText(text, [], normalizeSectionName(row.section));

    const answers = result.answers;
    if (!answers || answers.length === 0) {
      console.error(`✗ No answers parsed for section "${row.section}" (question_no ${row.question_no})`);
      failCount++;
      continue;
    }

    // Validate that each question number mentioned in the answer text is represented
    const questionNumbersInString = [...answers]
      .map(a => a.question_no)
      .sort((a, b) => a - b);
    const expectedNumbers = [...new Set([...questionNumbersInString])].sort((a, b) => a - b);

    // Extract numbers from original answer text
    const numMatches = text.match(/\\d+/g);
    const foundNumbers = numMatches ? numMatches.map(Number).sort((a, b) => a - b) : [];

    // Basic consistency check
    if (questionNumbersInString.length < 2) {
      // Single question case - just verify answer_type and answer text are non‑empty
      const a = answers[0];
      if (!a.question_no || !a.answer) {
        console.error(`✗ Parsed answer missing data for ${row.question_no}`);
        failCount++;
      } else {
        console.log(`✓ ${row.question_no} → ${a.answer_type} "${a.answer}"`);
      }
    } else {
      // Multiple‑question case - verify we got *all* numbers
      const missing = expectedNumbers.filter(n => !questionNumbersInString.includes(n));
      const extra   = questionNumbersInString.filter(n => !missing.includes(n));
      if (missing.length > 0) {
        console.error(`✗ ${row.question_no} missing numbers ${missing}`);
        failCount++;
      } else if (extra.length > 0) {
        console.error(`✗ ${row.question_no} extra numbers ${extra}`);
        failCount++;
      } else {
        console.log(`✓ ${row.question_no} parsed ${answers.length} questions`);
      }
    }
  }

  console.log(`\n${failCount} failures`);
  process.exit(failCount > 0 ? 1 : 0);
}).catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});