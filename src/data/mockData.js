export const mockStudents = [
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: '张三',
    class: '五年级·晚托班',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=zhangsan&backgroundColor=e6f7ff',
    created_at: '2024-04-20T10:00:00Z'
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
    name: '李四',
    class: '六年级·晚托班',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=lisi&backgroundColor=f6ffed',
    created_at: '2024-04-20T10:00:00Z'
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440003',
    name: '王五',
    class: '四年级·晚托班',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=wangwu&backgroundColor=fff1f0',
    created_at: '2024-04-20T10:00:00Z'
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440004',
    name: '赵六',
    class: '五年级·晚托班',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=zhaoliu&backgroundColor=e6f7ff',
    created_at: '2024-04-20T10:00:00Z'
  }
]

export const mockTasks = [
  {
    id: 'task-1',
    student_id: '550e8400-e29b-41d4-a716-446655440001',
    image_url: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=400&h=300&fit=crop',
    original_name: '2024-04-22_数学作业.jpg',
    status: 'done',
    result: { questionCount: 12, wrongCount: 5 },
    created_at: '2024-04-22T20:15:00Z'
  },
  {
    id: 'task-2',
    student_id: '550e8400-e29b-41d4-a716-446655440001',
    image_url: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=400&h=300&fit=crop',
    original_name: '2024-04-22_语文作业.jpg',
    status: 'processing',
    result: { progress: 60 },
    created_at: '2024-04-22T20:14:00Z'
  },
  {
    id: 'task-3',
    student_id: '550e8400-e29b-41d4-a716-446655440001',
    image_url: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&h=300&fit=crop',
    original_name: '2024-04-21_英语作业.jpg',
    status: 'done',
    result: { questionCount: 8, wrongCount: 2 },
    created_at: '2024-04-21T20:10:00Z'
  },
  {
    id: 'task-4',
    student_id: '550e8400-e29b-41d4-a716-446655440001',
    image_url: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=400&h=300&fit=crop',
    original_name: '2024-04-20_数学试卷.jpg',
    status: 'failed',
    result: { error: '识别失败，请重新上传或重试' },
    created_at: '2024-04-20T20:05:00Z'
  },
  {
    id: 'task-5',
    student_id: '550e8400-e29b-41d4-a716-446655440002',
    image_url: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=400&h=300&fit=crop',
    original_name: '2024-04-22_数学作业.jpg',
    status: 'done',
    result: { questionCount: 8, wrongCount: 3 },
    created_at: '2024-04-22T19:15:00Z'
  },
  {
    id: 'task-6',
    student_id: '550e8400-e29b-41d4-a716-446655440002',
    image_url: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=400&h=300&fit=crop',
    original_name: '2024-04-21_语文作业.jpg',
    status: 'failed',
    result: { error: '图片模糊，请重新上传' },
    created_at: '2024-04-21T18:14:00Z'
  },
  {
    id: 'task-7',
    student_id: '550e8400-e29b-41d4-a716-446655440003',
    image_url: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=400&h=300&fit=crop',
    original_name: '2024-04-22_数学作业.jpg',
    status: 'done',
    result: { questionCount: 10, wrongCount: 4 },
    created_at: '2024-04-22T17:15:00Z'
  },
  {
    id: 'task-8',
    student_id: '550e8400-e29b-41d4-a716-446655440003',
    image_url: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=400&h=300&fit=crop',
    original_name: '2024-04-20_英语作业.jpg',
    status: 'failed',
    result: { error: '识别失败' },
    created_at: '2024-04-20T16:10:00Z'
  },
  {
    id: 'task-9',
    student_id: '550e8400-e29b-41d4-a716-446655440004',
    image_url: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=400&h=300&fit=crop',
    original_name: '2024-04-22_数学作业.jpg',
    status: 'done',
    result: { questionCount: 6, wrongCount: 2 },
    created_at: '2024-04-22T15:15:00Z'
  },
  {
    id: 'task-10',
    student_id: '550e8400-e29b-41d4-a716-446655440004',
    image_url: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=400&h=300&fit=crop',
    original_name: '2024-04-21_语文作业.jpg',
    status: 'failed',
    result: { error: '处理超时' },
    created_at: '2024-04-21T14:10:00Z'
  },
  {
    id: 'task-11',
    student_id: '550e8400-e29b-41d4-a716-446655440004',
    image_url: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&h=300&fit=crop',
    original_name: '2024-04-20_英语作业.jpg',
    status: 'failed',
    result: { error: '识别失败' },
    created_at: '2024-04-20T13:05:00Z'
  }
]

export const mockQuestions = [
  { id: 'q-1', task_id: 'task-1', student_id: '550e8400-e29b-41d4-a716-446655440001', content: '在平面直角坐标系 xOy 中，已知点 A(0,2)、B(1,3)，则线段 AB 的长度是？', options: ['1', '√2', '√5', '2'], answer: 'C', student_answer: 'A', is_correct: false, question_type: 'choice', subject: '数学', analysis: '根据两点间距离公式，AB = √[(1-0)² + (3-2)²] = √(1+1) = √2', created_at: '2024-04-22T20:15:00Z' },
  { id: 'q-2', task_id: 'task-1', student_id: '550e8400-e29b-41d4-a716-446655440001', content: '计算：36 ÷ (2+1) × 5 = ?', options: ['60', '30', '20', '12'], answer: 'A', student_answer: 'A', is_correct: true, question_type: 'choice', subject: '数学', analysis: '先算括号：2+1=3，然后 36÷3=12，最后 12×5=60', created_at: '2024-04-22T20:15:00Z' },
  { id: 'q-3', task_id: 'task-1', student_id: '550e8400-e29b-41d4-a716-446655440001', content: '函数 y = 2x - 3 的图象经过哪个象限？', options: ['第一、二、三象限', '第一、三、四象限', '第一、二、四象限', '第二、三、四象限'], answer: 'B', student_answer: 'C', is_correct: false, question_type: 'choice', subject: '数学', analysis: 'k=2>0，b=-3<0，所以图象经过第一、三、四象限', created_at: '2024-04-22T20:15:00Z' },
  { id: 'q-4', task_id: 'task-1', student_id: '550e8400-e29b-41d4-a716-446655440001', content: '解方程：2x + 5 = 15', options: ['x = 5', 'x = 10', 'x = 20', 'x = 7.5'], answer: 'A', student_answer: 'A', is_correct: true, question_type: 'choice', subject: '数学', analysis: '2x = 15 - 5 = 10，所以 x = 5', created_at: '2024-04-22T20:15:00Z' },
  { id: 'q-5', task_id: 'task-3', student_id: '550e8400-e29b-41d4-a716-446655440001', content: '下列各数中，是无理数的是？', options: ['0.5', '√4', 'π', '3/4'], answer: 'C', student_answer: 'B', is_correct: false, question_type: 'choice', subject: '数学', analysis: 'π 是无限不循环小数，是无理数；√4=2 是有理数', created_at: '2024-04-21T20:10:00Z' },
  { id: 'q-6', task_id: 'task-3', student_id: '550e8400-e29b-41d4-a716-446655440001', content: '一个三角形的三个内角分别是 30°、60°、90°，这是一个什么三角形？', options: ['锐角三角形', '直角三角形', '钝角三角形', '等腰三角形'], answer: 'B', student_answer: 'B', is_correct: true, question_type: 'choice', subject: '数学', analysis: '有一个角是 90° 的三角形是直角三角形', created_at: '2024-04-21T20:10:00Z' },
  { id: 'q-7', task_id: 'task-5', student_id: '550e8400-e29b-41d4-a716-446655440002', content: '已知函数 f(x) = x² + 2x + 1，求 f(2) 的值', options: ['7', '9', '11', '13'], answer: 'B', student_answer: 'A', is_correct: false, question_type: 'choice', subject: '数学', analysis: 'f(2) = 2² + 2×2 + 1 = 4 + 4 + 1 = 9', created_at: '2024-04-22T19:15:00Z' },
  { id: 'q-8', task_id: 'task-5', student_id: '550e8400-e29b-41d4-a716-446655440002', content: '计算：(-3)² = ?', options: ['-9', '9', '6', '-6'], answer: 'B', student_answer: 'B', is_correct: true, question_type: 'choice', subject: '数学', analysis: '负数的偶次幂为正，(-3)² = 9', created_at: '2024-04-22T19:15:00Z' },
  { id: 'q-9', task_id: 'task-7', student_id: '550e8400-e29b-41d4-a716-446655440003', content: '若 a > b > 0，则下列不等式正确的是？', options: ['a² < b²', 'a² > b²', 'a² = b²', '无法判断'], answer: 'B', student_answer: 'A', is_correct: false, question_type: 'choice', subject: '数学', analysis: 'a > b > 0 时，两边同时平方得 a² > b²', created_at: '2024-04-22T17:15:00Z' },
  { id: 'q-10', task_id: 'task-7', student_id: '550e8400-e29b-41d4-a716-446655440003', content: '化简：√18 = ?', options: ['3√2', '2√3', '6', '9'], answer: 'A', student_answer: 'A', is_correct: true, question_type: 'choice', subject: '数学', analysis: '√18 = √(9×2) = 3√2', created_at: '2024-04-22T17:15:00Z' },
  { id: 'q-11', task_id: 'task-9', student_id: '550e8400-e29b-41d4-a716-446655440004', content: '一次函数 y = -2x + 4 的斜率是？', options: ['2', '-2', '4', '-4'], answer: 'B', student_answer: 'B', is_correct: true, question_type: 'choice', subject: '数学', analysis: '一次函数 y = kx + b 中，k 即为斜率，这里 k = -2', created_at: '2024-04-22T15:15:00Z' },
  { id: 'q-12', task_id: 'task-9', student_id: '550e8400-e29b-41d4-a716-446655440004', content: '解不等式：3x - 6 > 0', options: ['x > 2', 'x < 2', 'x > -2', 'x < -2'], answer: 'A', student_answer: 'C', is_correct: false, question_type: 'choice', subject: '数学', analysis: '3x > 6，所以 x > 2', created_at: '2024-04-22T15:15:00Z' }
]

// 错题本数据 - 包含科目、错误次数、加入时间等完整信息
export const mockWrongQuestions = [
  { 
    id: 'wq-1', 
    student_id: '550e8400-e29b-41d4-a716-446655440001', 
    question_id: 'q-1', 
    question: mockQuestions[0], 
    status: 'pending', 
    error_count: 3, 
    practice_count: 2,
    subject: '数学',
    category: '几何',
    added_at: '2024-04-22T20:15:00Z',
    last_wrong_at: '2024-04-22T20:15:00Z', 
    created_at: '2024-04-22T20:15:00Z' 
  },
  { 
    id: 'wq-2', 
    student_id: '550e8400-e29b-41d4-a716-446655440001', 
    question_id: 'q-3', 
    question: mockQuestions[2], 
    status: 'pending', 
    error_count: 2, 
    practice_count: 1,
    subject: '数学',
    category: '函数',
    added_at: '2024-04-20T10:00:00Z',
    last_wrong_at: '2024-04-22T20:15:00Z', 
    created_at: '2024-04-22T20:15:00Z' 
  },
  { 
    id: 'wq-3', 
    student_id: '550e8400-e29b-41d4-a716-446655440001', 
    question_id: 'q-5', 
    question: mockQuestions[4], 
    status: 'mastered', 
    error_count: 1, 
    practice_count: 3,
    subject: '数学',
    category: '数与式',
    added_at: '2024-04-15T14:30:00Z',
    last_wrong_at: '2024-04-21T20:10:00Z', 
    created_at: '2024-04-21T20:10:00Z' 
  },
  { 
    id: 'wq-4', 
    student_id: '550e8400-e29b-41d4-a716-446655440002', 
    question_id: 'q-7', 
    question: mockQuestions[6], 
    status: 'pending', 
    error_count: 4, 
    practice_count: 1,
    subject: '数学',
    category: '函数',
    added_at: '2024-04-18T09:00:00Z',
    last_wrong_at: '2024-04-22T19:15:00Z', 
    created_at: '2024-04-22T19:15:00Z' 
  },
  { 
    id: 'wq-5', 
    student_id: '550e8400-e29b-41d4-a716-446655440003', 
    question_id: 'q-9', 
    question: mockQuestions[8], 
    status: 'pending', 
    error_count: 2, 
    practice_count: 0,
    subject: '数学',
    category: '不等式',
    added_at: '2024-04-19T16:00:00Z',
    last_wrong_at: '2024-04-22T17:15:00Z', 
    created_at: '2024-04-22T17:15:00Z' 
  },
  { 
    id: 'wq-6', 
    student_id: '550e8400-e29b-41d4-a716-446655440004', 
    question_id: 'q-12', 
    question: mockQuestions[11], 
    status: 'mastered', 
    error_count: 1, 
    practice_count: 4,
    subject: '数学',
    category: '不等式',
    added_at: '2024-04-10T11:00:00Z',
    last_wrong_at: '2024-04-22T15:15:00Z', 
    created_at: '2024-04-22T15:15:00Z' 
  },
  { 
    id: 'wq-7', 
    student_id: '550e8400-e29b-41d4-a716-446655440004', 
    question_id: 'q-1', 
    question: mockQuestions[0], 
    status: 'pending', 
    error_count: 5, 
    practice_count: 2,
    subject: '数学',
    category: '几何',
    added_at: '2024-04-05T08:30:00Z',
    last_wrong_at: '2024-04-22T14:15:00Z', 
    created_at: '2024-04-22T14:15:00Z' 
  },
  { 
    id: 'wq-8', 
    student_id: '550e8400-e29b-41d4-a716-446655440002', 
    question_id: 'q-3', 
    question: mockQuestions[2], 
    status: 'mastered', 
    error_count: 1, 
    practice_count: 3,
    subject: '数学',
    category: '函数',
    added_at: '2024-04-12T13:00:00Z',
    last_wrong_at: '2024-04-20T10:00:00Z', 
    created_at: '2024-04-20T10:00:00Z' 
  },
  { 
    id: 'wq-9', 
    student_id: '550e8400-e29b-41d4-a716-446655440001', 
    question_id: 'q-7', 
    question: mockQuestions[6], 
    status: 'pending', 
    error_count: 3, 
    practice_count: 1,
    subject: '数学',
    category: '函数',
    added_at: '2024-04-08T15:30:00Z',
    last_wrong_at: '2024-04-18T16:00:00Z', 
    created_at: '2024-04-18T16:00:00Z' 
  },
  { 
    id: 'wq-10', 
    student_id: '550e8400-e29b-41d4-a716-446655440003', 
    question_id: 'q-5', 
    question: mockQuestions[4], 
    status: 'mastered', 
    error_count: 2, 
    practice_count: 5,
    subject: '数学',
    category: '数与式',
    added_at: '2024-04-14T09:30:00Z',
    last_wrong_at: '2024-04-16T11:00:00Z', 
    created_at: '2024-04-16T11:00:00Z' 
  },
  { 
    id: 'wq-11', 
    student_id: '550e8400-e29b-41d4-a716-446655440004', 
    question_id: 'q-2', 
    question: mockQuestions[1], 
    status: 'pending', 
    error_count: 3, 
    practice_count: 0,
    subject: '数学',
    category: '计算',
    added_at: '2024-04-15T10:00:00Z',
    last_wrong_at: '2024-04-22T16:00:00Z', 
    created_at: '2024-04-22T16:00:00Z' 
  },
  { 
    id: 'wq-12', 
    student_id: '550e8400-e29b-41d4-a716-446655440004', 
    question_id: 'q-3', 
    question: mockQuestions[2], 
    status: 'pending', 
    error_count: 2, 
    practice_count: 1,
    subject: '数学',
    category: '函数',
    added_at: '2024-04-14T09:00:00Z',
    last_wrong_at: '2024-04-22T17:00:00Z', 
    created_at: '2024-04-22T17:00:00Z' 
  },
  { 
    id: 'wq-13', 
    student_id: '550e8400-e29b-41d4-a716-446655440004', 
    question_id: 'q-4', 
    question: mockQuestions[3], 
    status: 'pending', 
    error_count: 4, 
    practice_count: 2,
    subject: '数学',
    category: '方程',
    added_at: '2024-04-13T08:00:00Z',
    last_wrong_at: '2024-04-22T18:00:00Z', 
    created_at: '2024-04-22T18:00:00Z' 
  },
  { 
    id: 'wq-14', 
    student_id: '550e8400-e29b-41d4-a716-446655440004', 
    question_id: 'q-5', 
    question: mockQuestions[4], 
    status: 'pending', 
    error_count: 1, 
    practice_count: 0,
    subject: '数学',
    category: '数与式',
    added_at: '2024-04-12T07:00:00Z',
    last_wrong_at: '2024-04-22T19:00:00Z', 
    created_at: '2024-04-22T19:00:00Z' 
  },
  { 
    id: 'wq-15', 
    student_id: '550e8400-e29b-41d4-a716-446655440004', 
    question_id: 'q-6', 
    question: mockQuestions[5], 
    status: 'pending', 
    error_count: 2, 
    practice_count: 1,
    subject: '数学',
    category: '几何',
    added_at: '2024-04-11T06:00:00Z',
    last_wrong_at: '2024-04-22T20:00:00Z', 
    created_at: '2024-04-22T20:00:00Z' 
  },
  { 
    id: 'wq-16', 
    student_id: '550e8400-e29b-41d4-a716-446655440004', 
    question_id: 'q-7', 
    question: mockQuestions[6], 
    status: 'mastered', 
    error_count: 1, 
    practice_count: 4,
    subject: '数学',
    category: '函数',
    added_at: '2024-04-10T05:00:00Z',
    last_wrong_at: '2024-04-22T21:00:00Z', 
    created_at: '2024-04-22T21:00:00Z' 
  },
  { 
    id: 'wq-17', 
    student_id: '550e8400-e29b-41d4-a716-446655440004', 
    question_id: 'q-8', 
    question: mockQuestions[7], 
    status: 'mastered', 
    error_count: 3, 
    practice_count: 6,
    subject: '数学',
    category: '计算',
    added_at: '2024-04-09T04:00:00Z',
    last_wrong_at: '2024-04-22T22:00:00Z', 
    created_at: '2024-04-22T22:00:00Z' 
  },
  { 
    id: 'wq-18', 
    student_id: '550e8400-e29b-41d4-a716-446655440004', 
    question_id: 'q-9', 
    question: mockQuestions[8], 
    status: 'mastered', 
    error_count: 2, 
    practice_count: 3,
    subject: '数学',
    category: '不等式',
    added_at: '2024-04-08T03:00:00Z',
    last_wrong_at: '2024-04-22T23:00:00Z', 
    created_at: '2024-04-22T23:00:00Z' 
  },
  { 
    id: 'wq-19', 
    student_id: '550e8400-e29b-41d4-a716-446655440004', 
    question_id: 'q-10', 
    question: mockQuestions[9], 
    status: 'mastered', 
    error_count: 1, 
    practice_count: 2,
    subject: '数学',
    category: '几何',
    added_at: '2024-04-07T02:00:00Z',
    last_wrong_at: '2024-04-22T23:59:00Z', 
    created_at: '2024-04-22T23:59:00Z' 
  },
  { 
    id: 'wq-20', 
    student_id: '550e8400-e29b-41d4-a716-446655440001', 
    question_id: 'q-2', 
    question: mockQuestions[1], 
    status: 'partial', 
    error_count: 2, 
    practice_count: 2,
    subject: '数学',
    category: '计算',
    added_at: '2024-04-16T11:00:00Z',
    last_wrong_at: '2024-04-22T14:00:00Z', 
    created_at: '2024-04-22T14:00:00Z' 
  },
  { 
    id: 'wq-21', 
    student_id: '550e8400-e29b-41d4-a716-446655440001', 
    question_id: 'q-4', 
    question: mockQuestions[3], 
    status: 'partial', 
    error_count: 1, 
    practice_count: 1,
    subject: '数学',
    category: '方程',
    added_at: '2024-04-10T09:00:00Z',
    last_wrong_at: '2024-04-20T16:00:00Z', 
    created_at: '2024-04-20T16:00:00Z' 
  }
]

// 从错题本生成的试卷 mock 数据
export const mockGeneratedExams = [
  {
    id: 'gen-exam-1',
    student_id: '550e8400-e29b-41d4-a716-446655440001',
    name: '错题组卷 - 2024年04月22日',
    question_ids: ['q-1', 'q-3', 'q-7'],
    status: 'graded',
    created_at: '2024-04-22T20:30:00Z',
    graded_at: '2024-04-22T21:00:00Z',
    printed: false,
    image_url: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=800&h=1200&fit=crop',
    correct_count: 2,
    wrong_count: 1
  },
  {
    id: 'gen-exam-2',
    student_id: '550e8400-e29b-41d4-a716-446655440001',
    name: '错题组卷 - 2024年04月20日',
    question_ids: ['q-2', 'q-5'],
    status: 'ungraded',
    created_at: '2024-04-20T15:00:00Z',
    printed: true
  },
  {
    id: 'gen-exam-3',
    student_id: '550e8400-e29b-41d4-a716-446655440001',
    name: '错题组卷 - 2024年04月18日',
    question_ids: ['q-1', 'q-3', 'q-5', 'q-7'],
    status: 'graded',
    created_at: '2024-04-18T10:00:00Z',
    graded_at: '2024-04-18T11:00:00Z',
    printed: false,
    image_url: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=800&h=1200&fit=crop',
    correct_count: 3,
    wrong_count: 1
  },
  {
    id: 'gen-exam-4',
    student_id: '550e8400-e29b-41d4-a716-446655440002',
    name: '错题组卷 - 2024年04月21日',
    question_ids: ['q-7'],
    status: 'ungraded',
    created_at: '2024-04-21T14:00:00Z',
    printed: true
  },
  {
    id: 'gen-exam-5',
    student_id: '550e8400-e29b-41d4-a716-446655440003',
    name: '错题组卷 - 2024年04月23日',
    question_ids: ['q-9', 'q-10', 'q-1', 'q-3'],
    status: 'graded',
    created_at: '2024-04-23T09:00:00Z',
    graded_at: '2024-04-23T10:00:00Z',
    printed: false,
    image_url: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&h=1200&fit=crop',
    correct_count: 2,
    wrong_count: 2
  }
]

// 试卷 mock 数据
export const mockExams = [
  {
    id: 'exam-1',
    student_id: '550e8400-e29b-41d4-a716-446655440002',
    exam_no: 'P20240423-001',
    name: '二次函数综合练习卷',
    thumbnail: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=200&h=150&fit=crop',
    question_count: 20,
    status: 'ungraded',
    created_at: '2024-04-23T14:30:00Z',
    graded_at: null
  },
  {
    id: 'exam-2',
    student_id: '550e8400-e29b-41d4-a716-446655440002',
    exam_no: 'P20240422-002',
    name: '因式分解专项训练',
    thumbnail: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=200&h=150&fit=crop',
    question_count: 15,
    status: 'ungraded',
    created_at: '2024-04-22T09:15:00Z',
    graded_at: null
  },
  {
    id: 'exam-3',
    student_id: '550e8400-e29b-41d4-a716-446655440002',
    exam_no: 'P20240420-001',
    name: '一元一次方程应用题',
    thumbnail: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=200&h=150&fit=crop',
    question_count: 18,
    status: 'graded',
    created_at: '2024-04-20T16:45:00Z',
    graded_at: '2024-04-20T18:20:00Z'
  },
  {
    id: 'exam-4',
    student_id: '550e8400-e29b-41d4-a716-446655440002',
    exam_no: 'P20240418-003',
    name: '几何图形计算题',
    thumbnail: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=200&h=150&fit=crop',
    question_count: 12,
    status: 'graded',
    created_at: '2024-04-18T10:20:00Z',
    graded_at: '2024-04-18T11:05:00Z'
  },
  {
    id: 'exam-5',
    student_id: '550e8400-e29b-41d4-a716-446655440002',
    exam_no: 'P20240415-001',
    name: '分数应用题专项',
    thumbnail: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=200&h=150&fit=crop',
    question_count: 16,
    status: 'ungraded',
    created_at: '2024-04-15T15:30:00Z',
    graded_at: null
  },
  {
    id: 'exam-6',
    student_id: '550e8400-e29b-41d4-a716-446655440001',
    exam_no: 'P20240422-001',
    name: '数学期中模拟卷',
    thumbnail: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=200&h=150&fit=crop',
    question_count: 25,
    status: 'graded',
    created_at: '2024-04-22T10:00:00Z',
    graded_at: '2024-04-22T12:30:00Z'
  },
  {
    id: 'exam-7',
    student_id: '550e8400-e29b-41d4-a716-446655440001',
    exam_no: 'P20240420-002',
    name: '代数基础练习',
    thumbnail: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=200&h=150&fit=crop',
    question_count: 15,
    status: 'ungraded',
    created_at: '2024-04-20T14:00:00Z',
    graded_at: null
  },
  {
    id: 'exam-8',
    student_id: '550e8400-e29b-41d4-a716-446655440003',
    exam_no: 'P20240421-001',
    name: '数学周测试卷',
    thumbnail: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=200&h=150&fit=crop',
    question_count: 20,
    status: 'graded',
    created_at: '2024-04-21T09:00:00Z',
    graded_at: '2024-04-21T11:00:00Z'
  }
]
