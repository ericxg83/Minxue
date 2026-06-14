-- ============================================
-- 敏学App V3 - Shadow Mode: 新增 judgements 表
-- 只追加，不覆盖。用于记录所有AI/人工判定历史。
-- 错题本仍然使用 wrong_questions 表，暂时不变。
-- ============================================

CREATE TABLE IF NOT EXISTS judgements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL,
    student_id UUID NOT NULL,
    source VARCHAR(20) NOT NULL CHECK (source IN ('ai_ocr', 'ai_answer_gen', 'manual_review', 'pc_edit')),
    confidence DECIMAL(3,2),
    is_correct BOOLEAN,
    content TEXT,
    answer TEXT,
    student_answer TEXT,
    ai_answer TEXT,
    analysis TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_judgements_question_id ON judgements(question_id);
CREATE INDEX IF NOT EXISTS idx_judgements_student_id ON judgements(student_id);
CREATE INDEX IF NOT EXISTS idx_judgements_source ON judgements(source);
CREATE INDEX IF NOT EXISTS idx_judgements_created_at ON judgements(created_at DESC);
