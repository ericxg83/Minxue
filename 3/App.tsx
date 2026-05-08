/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { 
  Camera, 
  ChevronRight, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  BookOpen, 
  LayoutGrid, 
  FileText, 
  Sparkles,
  Search,
  Bell,
  Plus,
  Scan,
  Printer,
  Edit3,
  X,
  Trash2,
  ChevronDown,
  User,
  Image as ImageIcon,
  Maximize,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
type Status = 'all' | 'processing' | 'done' | 'failed';
type ConfirmFilter = 'suspicious' | 'all' | 'correct';
type BankFilter = 'all' | 'unmastered' | 'mastered';
type ExamFilter = 'all' | 'unprocessed' | 'processed';

interface Student {
  id: string;
  name: string;
  classInfo: string;
  avatar: string;
  unreadCount?: number;
}

interface ScanRecord {
  id: string;
  name: string;
  timestamp: string;
  status: 'done' | 'failed' | 'processing';
  count?: number;
  duration?: string;
  thumbnail: string;
  errorMsg?: string;
}

interface Question {
  id: string;
  type: string;
  subject: string;
  isSuspicious: boolean;
  content: string;
  options?: string[];
  status: 'pending' | 'correct' | 'unmastered' | 'mastered';
  date: string;
  errorCount: number;
  knowledgePoints?: string[];
}

// --- Mock Data ---
const MOCK_STUDENTS: Student[] = [
  { id: 'zhl', name: '诸葛亮', classInfo: '高三·1班', avatar: '诸', unreadCount: 2 },
  { id: 'zs', name: '张三', classInfo: '初一·1班', avatar: '张' },
  { id: 'ls', name: '李四', classInfo: '五年级·2班', avatar: '李' },
  { id: 'ww', name: '王五', classInfo: '初三·1班', avatar: '王' },
  { id: 'zl', name: '赵六', classInfo: '初二·2班', avatar: '赵' },
];

const MOCK_QUESTIONS: Question[] = [
  // Questions for "Wait for Confirmation" (待核对)
  {
    id: 'q1',
    type: '解答题',
    subject: '数学',
    isSuspicious: true,
    status: 'pending',
    date: '2026-04-29',
    errorCount: 1,
    content: '已知直线 l 与直线 y=2x+1 的交点的横坐标为 2，与直线 y=-x+2 的交点的纵坐标为 1，求直线 l 的函数表达式。',
    knowledgePoints: ['一次函数', '二元一次方程组']
  },
  {
    id: 'q2',
    type: '选择题',
    subject: '数学',
    isSuspicious: false,
    status: 'pending',
    date: '2026-04-28',
    errorCount: 1,
    content: '在等差数列 {an} 中，a1=2, a3=6，则公差 d 为多少？',
    knowledgePoints: ['等差数列', '通项公式']
  },
  {
    id: 'q3',
    type: '解答题',
    subject: '语文',
    isSuspicious: false,
    status: 'correct',
    date: '2026-04-27',
    errorCount: 2,
    content: '请结合全文，分析文中“那一抹阳光”在情感表达上的作用。',
    knowledgePoints: ['现代文阅读', '修辞手法', '情感分析']
  },
  {
    id: 'q4',
    type: '选择题',
    subject: '物理',
    isSuspicious: false,
    status: 'correct',
    date: '2026-04-26',
    errorCount: 1,
    content: '关于重力，下列说法中正确的是：',
    options: [
      'A. 物体只有在静止时才受到重力',
      'B. 物体受到的重力方向总是竖直向下的',
      'C. 物体在空中下落时受到的重力比静止时大',
      'D. 重力就是万有引力'
    ],
    knowledgePoints: ['牛顿力学', '万有引力']
  },
  // Questions for "Wrong Question Bank" (错题本) - These are definitely wrong questions
  {
    id: 'q5',
    type: '选择题',
    subject: '物理',
    isSuspicious: false, // In wrong bank, we display fixed state
    status: 'unmastered',
    date: '2026-04-25',
    errorCount: 3,
    content: '一个物体在水平力 F 的作用下静止在斜面上，若增大水平力 F 而物体仍保持静止，则物体受到的摩擦力如何变化？',
    options: [
      'A. 一定增大',
      'B. 一定减小',
      'C. 可能增大，也可能减小',
      'D. 可能为零'
    ],
    knowledgePoints: ['摩擦力分析', '受力平衡']
  },
  {
    id: 'q6',
    type: '解答题',
    subject: '数学',
    isSuspicious: false,
    status: 'mastered',
    date: '2026-04-24',
    errorCount: 2,
    content: '已知函数 f(x) = ax² + bx + c 的图象过点(1,0)，且在 x=2 处取得极值，求 2a+b 的值。',
    knowledgePoints: ['二次函数', '导数极值']
  },
  {
    id: 'q7',
    type: '简答题',
    subject: '化学',
    isSuspicious: false,
    status: 'unmastered',
    date: '2026-04-23',
    errorCount: 2,
    content: '若在实验室中制取氨气，应选择哪种发生装置？并写出该反应的化学方程式。',
    knowledgePoints: ['氨气制备', '反应装置']
  }
];

interface ExamPaper {
  id: string;
  name: string;
  timestamp: string;
  count: number;
  status: 'unprocessed' | 'processed';
  thumbnail: string;
}

const MOCK_EXAM_PAPERS: ExamPaper[] = [
  {
    id: 'p1',
    name: '2026-04-29 数学错题重练卷',
    timestamp: '2026-04-29 09:18',
    count: 10,
    status: 'unprocessed',
    thumbnail: 'https://images.unsplash.com/photo-1543286386-713bdd548da4?w=200&h=150&fit=crop'
  },
  {
    id: 'p2',
    name: '2026-04-25 期中复习错题集',
    timestamp: '2026-04-29 09:13',
    count: 6,
    status: 'unprocessed',
    thumbnail: 'https://images.unsplash.com/photo-1509062522246-3755977927d7?w=200&h=150&fit=crop'
  },
  {
    id: 'p3',
    name: '2026-04-20 几何专题强化训练',
    timestamp: '2026-04-29 09:07',
    count: 6,
    status: 'processed',
    thumbnail: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=200&h=150&fit=crop'
  },
  {
    id: 'p4',
    name: '2026-04-15 英语随堂测试卷',
    timestamp: '2026-04-29 08:33',
    count: 12,
    status: 'processed',
    thumbnail: 'https://images.unsplash.com/photo-1516979187457-637abb4f9353?w=200&h=150&fit=crop'
  }
];

const MOCK_RECORDS: ScanRecord[] = [
  {
    id: '1',
    name: '微信图片_20260428190806_488_36.jpg',
    timestamp: '09:18',
    status: 'done',
    count: 10,
    duration: '18:02',
    thumbnail: 'https://images.unsplash.com/photo-1543286386-713bdd548da4?w=100&h=100&fit=crop'
  },
  {
    id: '2',
    name: '微信图片_20260402194621_22_12.jpg',
    timestamp: '09:13',
    status: 'processing',
    count: 0,
    thumbnail: 'https://images.unsplash.com/photo-1509062522246-3755977927d7?w=100&h=100&fit=crop'
  },
  {
    id: '4',
    name: '1111.jpg',
    timestamp: '08:59',
    status: 'failed',
    errorMsg: 'timeout of 60000ms exceeded',
    thumbnail: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=100&h=100&fit=crop'
  }
];

export default function App() {
  const [students, setStudents] = useState<Student[]>(MOCK_STUDENTS);
  const [questions, setQuestions] = useState<Question[]>(MOCK_QUESTIONS);
  const [isAddStudentOpen, setIsAddStudentOpen] = useState(false);
  const [showOriginalPaper, setShowOriginalPaper] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showCropTool, setShowCropTool] = useState(false);
  const [activeStatus, setActiveStatus] = useState<Status>('all');
  const [activeTab, setActiveTab] = useState('process');
  const [showStudentSwitcher, setShowStudentSwitcher] = useState(false);
  const [currentStudent, setCurrentStudent] = useState(MOCK_STUDENTS[0]);
  
  // Confirm Page State
  const [confirmFilter, setConfirmFilter] = useState<ConfirmFilter>('all');
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>([]);
  
  // Bank Page State
  const [bankFilter, setBankFilter] = useState<BankFilter>('all');
  const [selectedSubject, setSelectedSubject] = useState<string>('全部');
  const [selectedTimeRange, setSelectedTimeRange] = useState<string>('全部');
  const [selectedErrorCount, setSelectedErrorCount] = useState<string>('全部');
  const [showFilters, setShowFilters] = useState(false);

  // Exam Page State
  const [examFilter, setExamFilter] = useState<ExamFilter>('all');
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  
  // Print Preview Overlay
  const [isPrintPreviewOpen, setIsPrintPreviewOpen] = useState(false);
  
  // Edit Modal State
  const [isEditing, setIsEditing] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [viewingQuestion, setViewingQuestion] = useState<Question | null>(null);
  const [selectedConfirmItems, setSelectedConfirmItems] = useState<Set<string>>(new Set());
  const [selectedBankItems, setSelectedBankItems] = useState<Set<string>>(new Set());
  const [editTab, setEditTab] = useState<'content' | 'image' | 'answer'>('content');

  const filteredRecords = MOCK_RECORDS.filter(r => 
    activeStatus === 'all' ? true : (activeStatus === 'done' ? r.status === 'done' : activeStatus === 'failed' ? r.status === 'failed' : r.status === 'processing')
  );

  const filteredQuestions = questions.filter(q => {
    if (activeTab === 'confirm') {
      if (confirmFilter === 'suspicious') return q.isSuspicious;
      if (confirmFilter === 'correct') return q.status === 'correct' && !q.isSuspicious;
      return q.status === 'pending' || q.status === 'correct' || q.isSuspicious;
    }
    if (activeTab === 'bank') {
      // Primary state filters
      if (bankFilter === 'unmastered' && q.status !== 'unmastered') return false;
      if (bankFilter === 'mastered' && q.status !== 'mastered') return false;
      if (bankFilter === 'all' && (q.status !== 'unmastered' && q.status !== 'mastered')) return false;

      // New sub-filters
      if (selectedSubject !== '全部' && q.subject !== selectedSubject) return false;
      
      // Time range filter (mock logic)
      if (selectedTimeRange === '7天内' && q.date < '2026-04-22') return false;
      if (selectedTimeRange === '30天内' && q.date < '2026-03-29') return false;

      // Error count filter
      if (selectedErrorCount === '3次以上' && q.errorCount < 3) return false;
      if (selectedErrorCount === '1次' && q.errorCount !== 1) return false;
      
      return true;
    }
    return true;
  });

  const filteredPapers = MOCK_EXAM_PAPERS.filter(p => {
    if (examFilter === 'unprocessed') return p.status === 'unprocessed';
    if (examFilter === 'processed') return p.status === 'processed';
    return true;
  });

  const toggleSelect = (id: string) => {
    setSelectedQuestions(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="min-h-screen bg-[#F2F2F7] text-slate-900 font-sans selection:bg-blue-100 flex justify-center">
      {/* Container simulating a mobile device width */}
      <div className="w-full max-w-md bg-[#F2F2F7] min-h-screen shadow-2xl relative overflow-hidden flex flex-col">
        
        {/* --- Global Header --- */}
        <header className="px-5 pt-12 pb-3 flex items-center justify-between sticky top-0 bg-white/80 backdrop-blur-xl z-30 border-b border-gray-100/50">
          <button 
            onClick={() => setShowStudentSwitcher(true)}
            className="flex items-center gap-2.5 group active:opacity-60 transition-opacity"
          >
            <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-sm ring-4 ring-blue-50">
              {currentStudent.avatar}
            </div>
            <div className="text-left">
              <h2 className="text-[15px] font-bold tracking-tight text-gray-900 flex items-center gap-1">
                {currentStudent.name}
                <ChevronRight size={14} className="text-gray-300 group-hover:text-blue-500 transition-colors" />
              </h2>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest leading-none mt-0.5">{currentStudent.classInfo}</p>
            </div>
          </button>

          <div className="flex items-center gap-1.5">
            <button className="p-2.5 rounded-full text-gray-400 hover:bg-gray-50 active:bg-gray-100 transition-all">
              <Scan size={20} strokeWidth={2.5} />
            </button>
            <div className="relative">
              <button className="p-2.5 rounded-full text-gray-400 hover:bg-gray-50 active:bg-gray-100">
                <Bell size={20} strokeWidth={2.5} />
              </button>
              {currentStudent.unreadCount && (
                <span className="absolute top-1 right-1 w-4.5 h-4.5 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center border-2 border-white">
                  {currentStudent.unreadCount}
                </span>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto no-scrollbar pb-40">
          <AnimatePresence mode="wait">
            {activeTab === 'process' && (
              <motion.div
                key="process-page"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="w-full"
              >
                {/* --- Scan Hero Section --- */}
                <section className="p-5">
                  <motion.button 
                    whileTap={{ scale: 0.98 }}
                    className="w-full relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-blue-600 to-indigo-700 p-8 text-white shadow-xl shadow-blue-200"
                  >
                    <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full blur-3xl -translate-y-12 translate-x-12" />
                    <div className="relative z-10 flex flex-col items-center">
                      <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-3xl flex items-center justify-center mb-4 border border-white/30 shadow-inner">
                        <Camera size={32} strokeWidth={2.5} />
                      </div>
                      <h1 className="text-xl font-black tracking-tight mb-1">拍照上传错题</h1>
                      <p className="text-white/60 text-[12px] font-medium tracking-wide">Qwen-VL 视觉大模型赋能</p>
                      <div className="mt-6 flex items-center gap-1.5 bg-white/15 px-4 py-1.5 rounded-full text-[10px] font-black tracking-widest uppercase truncate max-w-full">
                        <Sparkles size={12} fill="white" className="shrink-0" />
                        <span>AI 智能识别已就绪</span>
                      </div>
                    </div>
                  </motion.button>
                </section>

                <section className="px-5">
                  <div className="flex bg-white p-1 rounded-2xl shadow-sm">
                    {(['all', 'processing', 'done', 'failed'] as Status[]).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveStatus(tab)}
                        className={`flex-1 py-1.5 rounded-xl text-[12px] font-bold transition-all ${
                          activeStatus === tab 
                          ? 'bg-blue-50 text-blue-600' 
                          : 'text-gray-400 hover:text-gray-600'
                        }`}
                      >
                        {tab === 'all' && '全部'}
                        {tab === 'processing' && '处理中'}
                        {tab === 'done' && '已完成'}
                        {tab === 'failed' && '失败'}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="mt-5 px-5 space-y-3">
                  {filteredRecords.map((record) => (
                    <div key={record.id} className="bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border border-white">
                      <img src={record.thumbnail} className="w-14 h-14 object-cover rounded-xl shrink-0" alt="" />
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start mb-1">
                          <h4 className="text-[13px] font-bold text-gray-900 truncate pr-4">{record.name}</h4>
                          <span className="text-[10px] text-gray-400 font-bold">{record.timestamp}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {record.status === 'done' && (
                            <span className="text-[11px] text-green-600 font-bold flex items-center gap-1">
                              <CheckCircle2 size={12} strokeWidth={3} /> 已完成
                            </span>
                          )}
                          {record.status === 'processing' && (
                            <span className="text-[11px] text-blue-500 font-bold flex items-center gap-1">
                              <Loader2 size={12} strokeWidth={3} className="animate-spin" /> 处理中
                            </span>
                          )}
                          {record.status === 'failed' && (
                            <span className="text-[11px] text-red-500 font-bold flex items-center gap-1">
                              <XCircle size={12} strokeWidth={3} /> 失败
                            </span>
                          )}
                          <span className="text-[11px] text-gray-400 font-bold">• {record.count || 0}题</span>
                        </div>
                      </div>
                      <ChevronRight size={18} className="text-gray-200" />
                    </div>
                  ))}
                </section>
              </motion.div>
            )}

            {activeTab === 'confirm' && (
              <motion.div
                key="confirm-page"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="w-full"
              >
                {/* --- Segmented Filters & Select All --- */}
                <section className="px-5 pt-4 mb-5 flex items-center justify-between">
                  <div className="flex gap-2 overflow-x-auto no-scrollbar flex-1">
                    {[
                      { id: 'all', label: '待核对', count: questions.filter(q => q.status === 'pending' || q.status === 'correct' || q.isSuspicious).length },
                      { id: 'suspicious', label: '疑似错题', count: questions.filter(q => q.isSuspicious).length },
                      { id: 'correct', label: '判定正确', count: questions.filter(q => q.status === 'correct' && !q.isSuspicious).length }
                    ].map((filter) => (
                      <button
                        key={filter.id}
                        onClick={() => setConfirmFilter(filter.id as ConfirmFilter)}
                        className={`px-4 py-2 rounded-full text-[12px] font-bold flex items-center gap-1.5 transition-all whitespace-nowrap ${
                          confirmFilter === filter.id 
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-100'
                          : 'bg-gray-100/80 text-gray-400'
                        }`}
                      >
                        {filter.label}
                        <span className={`text-[10px] font-medium ${
                          confirmFilter === filter.id ? 'text-white/80' : 'text-gray-300'
                        }`}>
                          {filter.count}
                        </span>
                      </button>
                    ))}
                  </div>

                  <button 
                    onClick={() => {
                      if (selectedQuestions.length === filteredQuestions.length && filteredQuestions.length > 0) {
                        setSelectedQuestions([]);
                      } else {
                        setSelectedQuestions(filteredQuestions.map(q => q.id));
                      }
                    }}
                    className={`shrink-0 ml-3 px-3 py-1.5 rounded-full text-[10px] font-black tracking-tight transition-all uppercase flex items-center gap-1.5 whitespace-nowrap shadow-sm border ${
                      selectedQuestions.length === filteredQuestions.length && filteredQuestions.length > 0
                      ? 'bg-blue-600 text-white border-blue-600 shadow-blue-500/20' 
                      : 'bg-white text-blue-600 border-blue-50'
                    }`}
                  >
                    {selectedQuestions.length === filteredQuestions.length && filteredQuestions.length > 0 ? (
                      <><CheckCircle2 size={12} strokeWidth={3} /> 取消全选</>
                    ) : (
                      '全选'
                    )}
                  </button>
                </section>

                {/* --- Question List --- */}
                <section className="px-5 space-y-4">
                  {filteredQuestions.map((q, idx) => (
                    <motion.div 
                      key={q.id}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`bg-white rounded-[1.5rem] p-4 shadow-sm border-2 transition-all cursor-pointer relative ${
                        selectedQuestions.includes(q.id) ? 'border-blue-500 shadow-blue-50' : 'border-transparent'
                      }`}
                      onClick={() => setViewingQuestion(q)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-bold text-gray-300 italic">#{idx + 1}</span>
                          <span className={`px-2 py-0.5 rounded-lg text-[9px] font-bold tracking-tight uppercase flex items-center gap-1 ${
                            q.isSuspicious ? 'bg-red-50 text-red-500 border border-red-100' : 'bg-green-50 text-green-500 border border-green-100'
                          }`}>
                            {q.isSuspicious ? (
                              <><XCircle size={10} strokeWidth={3} /> 疑似错题</>
                            ) : (
                              <><CheckCircle2 size={10} strokeWidth={3} /> 判定正确</>
                            )}
                          </span>
                          <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{q.type}</span>
                        </div>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelect(q.id);
                          }}
                          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                            selectedQuestions.includes(q.id) ? 'bg-blue-600 border-blue-600' : 'border-gray-100 bg-white'
                          }`}
                        >
                          {selectedQuestions.includes(q.id) && <CheckCircle2 size={12} className="text-white" strokeWidth={4} />}
                        </button>
                      </div>

                      <div className="text-[14px] leading-snug text-gray-700 mb-4 px-1">
                        {q.content}
                      </div>

                        <div className="flex items-center justify-between border-t border-gray-50 pt-3">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowOriginalPaper(q.id);
                          }}
                          className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400 hover:text-blue-600 transition-colors"
                        >
                          <BookOpen size={13} strokeWidth={2.5} /> 查看原图
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </section>
              </motion.div>
            )}

            {activeTab === 'bank' && (
              <motion.div
                key="bank-page"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="w-full pb-32"
              >
                {/* Primary State Tabs & Select All --- */}
                <div className="flex items-center justify-between px-5 pt-4">
                  <div className="flex gap-2 overflow-x-auto no-scrollbar flex-1">
                    {[
                      { id: 'all', label: '全部', count: questions.filter(q => (q.status === 'unmastered' || q.status === 'mastered')).length },
                      { id: 'unmastered', label: '未掌握', count: questions.filter(q => q.status === 'unmastered').length },
                      { id: 'mastered', label: '已掌握', count: questions.filter(q => q.status === 'mastered').length }
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setBankFilter(tab.id as BankFilter)}
                        className={`px-4 py-2 rounded-full text-[12px] font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                          bankFilter === tab.id 
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-100'
                          : 'bg-white text-gray-400 border border-gray-100'
                        }`}
                      >
                        {tab.label}
                        <span className={`text-[10px] font-medium ${
                          bankFilter === tab.id ? 'text-white/80' : 'text-gray-300'
                        }`}>
                          {tab.count}
                        </span>
                      </button>
                    ))}
                  </div>

                  <button 
                    onClick={() => {
                      if (selectedQuestions.length === filteredQuestions.length) {
                        setSelectedQuestions([]);
                      } else {
                        setSelectedQuestions(filteredQuestions.map(q => q.id));
                      }
                    }}
                    className={`shrink-0 ml-3 px-3 py-1.5 rounded-full text-[10px] font-black tracking-tight transition-all uppercase flex items-center gap-1.5 whitespace-nowrap shadow-sm border ${
                      selectedQuestions.length === filteredQuestions.length && filteredQuestions.length > 0
                      ? 'bg-blue-600 text-white border-blue-600 shadow-blue-500/20' 
                      : 'bg-white text-blue-600 border-blue-50'
                    }`}
                  >
                    {selectedQuestions.length === filteredQuestions.length && filteredQuestions.length > 0 ? (
                      <><CheckCircle2 size={12} strokeWidth={3} /> 取消全选</>
                    ) : (
                      '全选'
                    )}
                  </button>
                </div>

                {/* Sub-Filters - Dropdown Style */}
                <div className="px-5 mt-4 flex items-center gap-2 overflow-x-auto no-scrollbar">
                  {[
                    { label: '科目', value: selectedSubject, options: ['全部', '数学', '语文', '物理', '化学', '生物'], setter: setSelectedSubject },
                    { id: 'time', label: '时间', value: selectedTimeRange, options: ['全部', '7天内', '30天内'], setter: setSelectedTimeRange },
                    { id: 'errors', label: '次数', value: selectedErrorCount, options: ['全部', '1次', '3次以上'], setter: setSelectedErrorCount },
                  ].map((filter, i) => (
                    <div key={i} className="relative shrink-0">
                      <select
                        value={filter.value}
                        onChange={(e) => filter.setter(e.target.value)}
                        className="appearance-none bg-white border border-gray-100 rounded-full pl-3 pr-7 py-1.5 text-[11px] font-bold text-gray-500 shadow-sm focus:outline-none focus:border-blue-200 transition-all cursor-pointer"
                      >
                        {filter.options.map(opt => (
                          <option key={opt} value={opt}>{filter.label}: {opt}</option>
                        ))}
                      </select>
                      <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                  ))}
                </div>


                {/* Question List */}
                <div className="px-5 mt-5 space-y-4">
                  {filteredQuestions.map((q) => (
                    <div 
                      key={q.id}
                      onClick={() => setViewingQuestion(q)}
                      className={`bg-white rounded-2xl p-5 shadow-sm border-2 transition-all cursor-pointer relative ${
                        selectedQuestions.includes(q.id) ? 'border-blue-500 shadow-blue-50' : 'border-transparent'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-500 text-[10px] font-black uppercase tracking-widest">{q.subject}</span>
                          <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{q.type}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] text-gray-300 font-medium">{q.date}</span>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelect(q.id);
                            }}
                            className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                               selectedQuestions.includes(q.id) ? 'bg-blue-600 border-blue-600' : 'border-gray-100 bg-white'
                            }`}
                          >
                            {selectedQuestions.includes(q.id) && <CheckCircle2 size={12} className="text-white" strokeWidth={3} />}
                          </button>
                        </div>
                      </div>
                      <div className="text-[14px] leading-relaxed text-gray-700 mb-4 px-1 line-clamp-2">
                        {q.content}
                      </div>
                      <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-50">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400">
                          <XCircle size={13} strokeWidth={2.5} className="text-red-200" /> 
                          错误次数: <span className="text-red-400 underline decoration-red-100 underline-offset-2">{q.errorCount}次</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded-lg text-[9px] font-bold uppercase tracking-tight ${
                          q.status === 'unmastered' ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-500'
                        }`}>
                          {q.status === 'unmastered' ? '未掌握' : '已掌握'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'exam' && (
              <motion.div
                key="exam-page"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="w-full pb-32"
              >
                {/* Filter Tabs */}
                <div className="flex gap-2 px-5 pt-4 overflow-x-auto no-scrollbar">
                  {[
                    { id: 'all', label: '全部', count: MOCK_EXAM_PAPERS.length },
                    { id: 'unprocessed', label: '未批改', count: MOCK_EXAM_PAPERS.filter(p => p.status === 'unprocessed').length },
                    { id: 'processed', label: '已批改', count: MOCK_EXAM_PAPERS.filter(p => p.status === 'processed').length }
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setExamFilter(tab.id as ExamFilter)}
                      className={`px-5 py-2.5 rounded-full text-[13px] font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                        examFilter === tab.id 
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-100'
                        : 'bg-white text-gray-400 border border-gray-100'
                      }`}
                    >
                      {tab.label}
                      <span className={`text-[11px] font-medium ${
                        examFilter === tab.id ? 'text-white/80' : 'text-gray-300'
                      }`}>
                        {tab.count}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Exam List */}
                <div className="px-5 mt-5 space-y-3">
                  {filteredPapers.map((paper) => (
                    <div 
                      key={paper.id}
                      onClick={() => setSelectedPaperId(paper.id)}
                      className={`bg-white rounded-2xl p-4 shadow-sm border-2 transition-all relative group ${
                        selectedPaperId === paper.id ? 'border-blue-500 shadow-xl shadow-blue-100/50' : 'border-transparent'
                      }`}
                    >
                      <div className="flex flex-col h-full"> 
                        {/* Content */}
                        <div className="flex-1 min-w-0 pr-8">
                          <h4 className="text-[14px] font-black text-gray-900 truncate tracking-tight mb-1.5 uppercase">
                            {paper.name}
                          </h4>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-400">
                            <div className="flex items-center gap-1.5">
                              <Search size={12} className="opacity-50" />
                              <span className="text-[11px] font-black uppercase tracking-tight">{paper.timestamp}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <FileText size={12} className="opacity-50" />
                              <span className="text-[11px] font-black uppercase tracking-tight">题目: {paper.count}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-50">
                          <span className={`px-3 py-1 rounded-full text-[9px] font-black tracking-widest uppercase ${
                            paper.status === 'unprocessed' 
                              ? 'bg-red-50/50 text-red-500 border border-red-100/50' 
                              : 'bg-green-50/50 text-green-500 border border-green-100/50'
                          }`}>
                            {paper.status === 'unprocessed' ? 'PENDING · 未批改' : 'GRADED · 已批改'}
                          </span>
                          
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsPrintPreviewOpen(true);
                            }}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-slate-900 text-white hover:bg-slate-800 transition-all active:scale-95 shadow-xl shadow-slate-200"
                          >
                            <Printer size={12} strokeWidth={3} />
                            <span className="text-[10px] font-black uppercase tracking-wider">重打印</span>
                          </button>
                        </div>
                      </div>

                      {/* Selection Indicator from Image 2 */}
                      <div className="absolute top-6 right-6">
                         <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                            selectedPaperId === paper.id ? 'bg-blue-600 border-blue-600' : 'border-gray-100'
                         }`}>
                           {selectedPaperId === paper.id && <div className="w-2 h-2 bg-white rounded-full" />}
                         </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Empty State */}
                {filteredPapers.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-24 opacity-20">
                    <FileText size={48} strokeWidth={1} />
                    <p className="mt-4 text-[13px] font-medium">暂无此类试卷</p>
                  </div>
                )}
              </motion.div>
            )}

        {/* --- Print Preview Overlay --- */}
        <AnimatePresence>
          {isPrintPreviewOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[1000] bg-gray-100 flex flex-col"
            >
              {/* Control Header */}
              <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-sm shrink-0">
                 <div className="flex items-center gap-4">
                   <button 
                     onClick={() => setIsPrintPreviewOpen(false)}
                     className="p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-400 active:bg-gray-50 active:scale-95 transition-all"
                   >
                     <X size={20} />
                   </button>
                   <div>
                     <h2 className="text-[16px] font-black text-gray-900 leading-tight">打印预览</h2>
                     <p className="text-[11px] font-bold text-gray-400 tracking-tight">已选 {selectedQuestions.length} 道题目</p>
                   </div>
                 </div>
                 <div className="flex items-center gap-3">
                   <button className="px-6 py-2.5 rounded-full border border-gray-200 text-[13px] font-black text-gray-600 hover:bg-gray-50 active:scale-95 transition-all">
                     PDF 导出
                   </button>
                   <button 
                     onClick={() => {
                        setIsPrintPreviewOpen(false);
                     }}
                     className="px-6 py-2.5 rounded-full bg-blue-600 text-white text-[13px] font-black shadow-lg shadow-blue-500/10 active:scale-95 transition-all"
                   >
                     确认打印
                   </button>
                 </div>
              </div>

              {/* Realistic Exam Paper Container */}
              <div className="flex-1 overflow-y-auto bg-gray-100 py-10 px-6 no-scrollbar">
                 <div className="w-full max-w-[800px] mx-auto bg-white shadow-2xl p-[80px] min-h-[1132px] font-serif text-slate-900 border border-slate-100 relative">
                    {/* Watermark/Logo */}
                    <div className="absolute top-[80px] right-[80px] text-[10px] font-black text-slate-100 uppercase tracking-[0.4em] select-none rotate-90 origin-right">
                       Verified Learning Resource
                    </div>

                    {/* Paper Header */}
                    <div className="text-center mb-16 pb-12 border-b-2 border-slate-900 relative">
                       <h1 className="text-[32px] font-black tracking-[0.2em] mb-3 text-slate-900">错题巩固强化训练卷</h1>
                       <div className="flex items-center justify-center gap-10 mt-6 text-[14px] font-medium text-slate-600">
                          <span className="flex items-center gap-1">姓名：<span className="inline-block w-32 border-b border-slate-400" /></span>
                          <span className="flex items-center gap-1">班级：<span className="inline-block w-32 border-b border-slate-400" /></span>
                          <span className="flex items-center gap-1">得分：<span className="inline-block w-20 border-b border-slate-400" /></span>
                       </div>
                       <div className="mt-4 text-[12px] font-bold text-slate-400 tracking-widest uppercase">
                          日期: {new Date().toLocaleDateString()} | 卷面编号: AIS-EM-2026-{(Math.random()*10000).toFixed(0)}
                       </div>
                    </div>

                    {/* Questions Section */}
                    <div className="space-y-16">
                      {questions.filter(q => selectedQuestions.includes(q.id)).map((q, idx) => (
                        <div key={q.id} className="relative group">
                          <div className="flex items-start gap-4">
                            <span className="shrink-0 w-9 h-9 border-2 border-slate-900 rounded font-black flex items-center justify-center text-[16px]">
                              {idx + 1}
                            </span>
                            <div className="flex-1">
                               <div className="flex items-center gap-3 mb-2.5">
                                 <span className="text-[11px] font-black tracking-widest text-slate-300 uppercase italic">[{q.subject} · {q.type}]</span>
                               </div>
                               <div className="text-[18px] leading-[1.8] text-slate-900 whitespace-pre-wrap mb-8">
                                 {q.content}
                               </div>

                               {/* Dynamic Grid for Choice Options */}
                               {q.options && q.options.length > 0 && (
                                 <div className={`grid gap-x-12 gap-y-5 mb-10 ${
                                   q.options.every(opt => opt.length < 12) ? 'grid-cols-4' : 
                                   q.options.every(opt => opt.length < 24) ? 'grid-cols-2' : 'grid-cols-1'
                                 }`}>
                                   {q.options.map((opt, i) => (
                                     <div key={i} className="text-[16px] flex items-start gap-2">
                                       <span className="font-black text-slate-400">{String.fromCharCode(65 + i)}.</span>
                                       <span>{opt.startsWith(String.fromCharCode(65 + i)) ? opt.substring(2).trim() : opt}</span>
                                     </div>
                                   ))}
                                 </div>
                               )}

                               {/* Dynamic Answer Space for Non-Choice types */}
                               {(q.type.includes('解答') || q.type.includes('简答') || q.type.includes('填空')) && (
                                 <div className="mt-6">
                                    <div className="flex items-center gap-2 mb-4">
                                       <div className="w-1 h-3 bg-slate-900" />
                                       <span className="text-[12px] font-black text-slate-300 uppercase tracking-widest">答题区 Answer Area</span>
                                    </div>
                                    <div className={`border-2 border-dashed border-slate-100 rounded-xl bg-slate-50/20 ${
                                      q.type.includes('填空') ? 'min-h-[60px]' : 'min-h-[280px]'
                                    }`} />
                                 </div>
                               )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Footer Info */}
                    <div className="mt-32 pt-10 border-t border-slate-100 flex items-center justify-between text-[11px] font-bold text-slate-300 uppercase tracking-[0.2em] italic">
                       <span>Processed by Smart Learning Engine @2026</span>
                       <span>Final Page 1 of 1</span>
                    </div>
                 </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
          </AnimatePresence>
        </main>

        {/* --- iOS Tab Bar --- */}
        <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white/80 backdrop-blur-2xl border-t border-gray-100/50 flex justify-between px-8 pt-4 pb-8 z-[70]">
          {[
            { id: 'process', icon: Camera, label: '处理' },
            { id: 'confirm', icon: BookOpen, label: '待确认' },
            { id: 'bank', icon: LayoutGrid, label: '错题本' },
            { id: 'exam', icon: FileText, label: '试卷' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSelectedQuestions([]); }}
              className="flex flex-col items-center gap-1.5 transition-all group relative"
            >
              <tab.icon 
                size={22} 
                strokeWidth={activeTab === tab.id ? 2.5 : 2}
                className={activeTab === tab.id ? 'text-blue-600' : 'text-gray-300'} 
              />
              <span className={`text-[10px] font-bold tracking-[0.05em] uppercase ${activeTab === tab.id ? 'text-blue-600' : 'text-gray-400'}`}>
                {tab.label}
              </span>
              {activeTab === tab.id && (
                <motion.div layoutId="nav-pill" className="absolute -top-1 w-1 h-1 bg-blue-600 rounded-full" />
              )}
            </button>
          ))}
        </nav>

        {/* --- Student Sheet --- */}
        <AnimatePresence>
          {showStudentSwitcher && (
            <>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowStudentSwitcher(false)}
                className="absolute inset-0 bg-black/40 backdrop-blur-sm z-[100]"
              />
              <motion.div 
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 32, stiffness: 350 }}
                className="absolute bottom-0 left-0 right-0 bg-[#F2F2F7] rounded-t-[2.5rem] z-[101] flex flex-col max-h-[85vh] shadow-2xl"
              >
                <div className="w-10 h-1 bg-gray-300/40 rounded-full mx-auto my-3" />
                
                <div className="flex justify-between items-center px-6 py-2 mb-2">
                  <h3 className="text-lg font-bold text-gray-900 tracking-tight">切换学习档案</h3>
                  <button onClick={() => setShowStudentSwitcher(false)} className="w-8 h-8 flex items-center justify-center bg-gray-200/50 rounded-full text-gray-400 active:scale-90 transition-transform">
                    <X size={16} strokeWidth={3} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-4 pb-12 space-y-2 no-scrollbar">
                  {students.map(student => (
                    <div key={student.id} className="relative overflow-hidden rounded-2xl group">
                      {/* Delete Action Background */}
                      <div className="absolute inset-0 bg-red-500 flex justify-end items-center pr-6">
                        <button 
                          onClick={() => setStudents(students.filter(s => s.id !== student.id))}
                          className="flex flex-col items-center gap-1 text-white"
                        >
                          <Trash2 size={20} />
                          <span className="text-[10px] font-bold">删除</span>
                        </button>
                      </div>

                      {/* Foreground Content */}
                      <motion.div
                        drag="x"
                        dragConstraints={{ left: -80, right: 0 }}
                        dragElastic={0.1}
                        className={`relative z-10 w-full flex items-center justify-between p-3.5 rounded-2xl transition-shadow bg-white ${
                          student.id === currentStudent.id 
                          ? 'ring-2 ring-blue-500 shadow-lg shadow-blue-100' 
                          : 'shadow-sm border border-white'
                        }`}
                        onClick={() => { setCurrentStudent(student); setShowStudentSwitcher(false); }}
                      >
                        <div className="flex items-center gap-3.5">
                          <div className={`w-11 h-11 rounded-full flex items-center justify-center font-bold text-base bg-blue-50 text-blue-600 shadow-sm`}>
                            {student.avatar}
                          </div>
                          <div className="text-left">
                            <h4 className="font-bold text-[15px] text-gray-900 leading-tight">
                              {student.name}
                              {student.id === currentStudent.id && 
                                <span className="ml-2 py-0.5 px-1.5 bg-blue-100 text-blue-600 rounded text-[9px] font-black uppercase tracking-tighter align-middle">当前</span>
                              }
                            </h4>
                            <p className="text-[11px] font-medium text-gray-400 mt-0.5">{student.classInfo}</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-3">
                          {student.unreadCount && (
                            <span className="px-2 py-0.5 bg-red-500 text-white rounded-full text-[10px] font-black tracking-tighter">
                              {student.unreadCount}
                            </span>
                          )}
                          <ChevronRight size={16} className="text-gray-200" />
                        </div>
                      </motion.div>
                    </div>
                  ))}

                  <button 
                    onClick={() => { setShowStudentSwitcher(false); setIsAddStudentOpen(true); }}
                    className="w-full py-4 mt-4 flex items-center justify-center gap-2 bg-white rounded-2xl text-blue-600 font-bold text-sm shadow-sm active:scale-[0.98] transition-transform border border-dashed border-blue-100"
                  >
                    <Plus size={18} strokeWidth={3} />
                    <span>添加学生成员</span>
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* --- Add Student Modal --- */}
        <AnimatePresence>
          {isAddStudentOpen && (
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300, mass: 0.8 }}
              className="absolute inset-0 bg-[#F2F2F7] z-[250] flex flex-col"
            >
              {/* iOS Style Header */}
              <div className="bg-white/80 backdrop-blur-xl px-4 pt-12 pb-3 border-b border-gray-100 flex items-center justify-between sticky top-0 z-10">
                <button 
                  onClick={() => setIsAddStudentOpen(false)}
                  className="text-[16px] text-blue-600 active:opacity-40 px-2"
                >
                  取消
                </button>
                <h3 className="text-[17px] font-bold text-gray-900">添加学生</h3>
                <button 
                  onClick={() => setIsAddStudentOpen(false)}
                  className="text-[16px] font-bold text-blue-600 active:opacity-40 px-2"
                >
                  完成
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-8">
                {/* Avatar Section */}
                <div className="flex flex-col items-center mb-8">
                  <div className="w-24 h-24 bg-white rounded-full flex flex-col items-center justify-center shadow-sm border border-gray-100 mb-2 group active:scale-95 transition-transform cursor-pointer">
                    <Camera size={32} className="text-gray-300" strokeWidth={1.5} />
                    <span className="text-[10px] text-gray-400 font-bold mt-1">设置头像</span>
                  </div>
                </div>

                {/* Form Items Group */}
                <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-white">
                  {[
                    { label: '姓名', placeholder: '请输入学生姓名' },
                    { label: '年级', placeholder: '请选择年级', type: 'select' },
                    { label: '班级', placeholder: '请输入班级' },
                    { label: '备注', placeholder: '请输入备注（选填）' },
                  ].map((field, i, arr) => (
                    <div key={field.label} className={`flex items-center px-5 py-4 ${i !== arr.length - 1 ? 'border-b border-gray-50' : ''}`}>
                      <span className="w-16 text-[15px] font-medium text-gray-900">{field.label}</span>
                      <input 
                        type="text" 
                        placeholder={field.placeholder}
                        className="flex-1 text-[15px] text-gray-600 bg-transparent focus:outline-none placeholder:text-gray-300"
                      />
                      {field.type === 'select' && <ChevronRight size={16} className="text-gray-300" />}
                    </div>
                  ))}
                </div>
                
                <p className="px-5 mt-4 text-[12px] text-gray-400 leading-relaxed">
                  添加学生成员后，您可以为该学生独立管理错题本，查看学习档案及生成专属练习卷。
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- Edit Question Modal --- */}
        <AnimatePresence>
          {showDeleteConfirm && (
            <div className="fixed inset-0 z-[1000] flex items-center justify-center px-8">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowDeleteConfirm(null)}
                className="absolute inset-0 bg-black/60 backdrop-blur-md"
              />
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="relative w-full max-w-[280px] bg-white/90 backdrop-blur-xl rounded-[2rem] p-6 shadow-2xl text-center"
              >
                <div className="w-14 h-14 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Trash2 size={28} />
                </div>
                <h3 className="text-[17px] font-black text-gray-900 mb-2">确认删除该题目？</h3>
                <p className="text-[13px] text-gray-500 mb-6 leading-relaxed">
                  删除后将无法恢复，建议先确认为正确或自行修改。
                </p>
                <div className="space-y-2">
                  <button 
                    onClick={() => setShowDeleteConfirm(null)}
                    className="w-full py-3.5 bg-red-500 text-white font-black rounded-2xl shadow-lg shadow-red-100 active:scale-95 transition-transform"
                  >
                    确定删除
                  </button>
                  <button 
                    onClick={() => setShowDeleteConfirm(null)}
                    className="w-full py-3.5 text-gray-400 font-bold active:scale-95 transition-transform"
                  >
                    取消
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showOriginalPaper && (
            <div className="fixed inset-0 z-[1000] bg-black overflow-hidden">
              <motion.div 
                initial={{ opacity: 0, scale: 1.05 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                className="relative h-full w-full flex flex-col"
              >
                {/* Visual Glass Header */}
                <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-black/80 via-black/40 to-transparent z-20 px-6 pt-12 flex items-center justify-between pointer-events-none">
                  <div className="text-white pointer-events-auto">
                    <h3 className="text-[17px] font-black tracking-tight">2024届下学期数学期中检测</h3>
                    <p className="text-white/40 text-[10px] uppercase font-black tracking-widest mt-0.5">Scanned Paper · Page 1 of 4</p>
                  </div>
                  <button 
                    onClick={() => setShowOriginalPaper(null)}
                    className="w-10 h-10 bg-white/10 backdrop-blur-xl rounded-full flex items-center justify-center text-white active:scale-90 transition-transform pointer-events-auto border border-white/10"
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Scanned Paper Background */}
                <div className="flex-1 overflow-auto bg-[#1a1a1a] flex flex-col items-center pt-32 pb-40 px-4 no-scrollbar">
                   <div className="relative w-full max-w-2xl aspect-[1/1.414] bg-white shadow-[0_40px_100px_rgba(0,0,0,0.5)] rounded-sm overflow-hidden transform transition-transform">
                     {/* Scanned Paper Image - Uses a realistic paper texture/unfocused scan look */}
                     <img 
                       src="https://images.unsplash.com/photo-1588072432836-e10032774350?q=80&w=2000" 
                       className="w-full h-full object-cover opacity-90 blur-[0.5px]"
                       alt="Original Scanned Paper"
                     />
                     
                     {/* Paper Texture Overlay */}
                     <div className="absolute inset-0 bg-[#fdfaf5]/20 mix-blend-multiply pointer-events-none" />
                     
                     {/* Mocked Question Content on Paper */}
                     <div className="absolute inset-0 p-12 flex flex-col">
                        <div className="text-center mb-16 opacity-80">
                          <h1 className="text-2xl font-serif font-black text-gray-800 tracking-tighter">绝密 ★ 启用前</h1>
                          <p className="text-xl font-serif mt-4 font-bold text-gray-700">2024届数学测试卷</p>
                        </div>
                        
                        <div className="space-y-16">
                          {/* Highlight Area for Questions */}
                          {[1, 2, 3].map((num) => {
                            const qId = `q${num}`;
                            const isSelected = showOriginalPaper === qId;
                            return (
                              <div 
                                key={qId}
                                className={`relative p-6 rounded-2xl transition-all duration-700 ${isSelected ? 'bg-blue-500/5 border-2 border-blue-500/40 shadow-[0_0_40px_rgba(59,130,246,0.2)]' : 'opacity-20 grayscale'}`}
                              >
                                <div className="flex gap-4">
                                  <span className="font-serif font-black text-lg text-gray-800">{num}.</span>
                                  <div className="flex-1 space-y-3">
                                    <div className="h-4 bg-gray-900/10 rounded-full w-full" />
                                    <div className="h-4 bg-gray-900/10 rounded-full w-[80%]" />
                                    {num === 2 && (
                                       <div className="grid grid-cols-2 gap-4 pt-4">
                                          <div className="h-3 bg-gray-900/5 rounded-sm" />
                                          <div className="h-3 bg-gray-900/5 rounded-sm" />
                                       </div>
                                    )}
                                  </div>
                                </div>
                                {isSelected && (
                                  <motion.div 
                                    initial={{ scale: 0.8, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    className="absolute -top-12 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[11px] font-black px-4 py-2 rounded-full shadow-2xl flex items-center gap-2"
                                  >
                                    <Sparkles size={12} />
                                    第 {num} 题 · 当前定位
                                  </motion.div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                     </div>

                     {/* Vignette effect for realism */}
                     <div className="absolute inset-0 shadow-[inset_0_0_100px_rgba(0,0,0,0.1)] pointer-events-none" />
                   </div>
                </div>

                {/* Footer Controls */}
                <div className="absolute bottom-12 left-0 right-0 px-8 flex justify-center pointer-events-none">
                  <motion.div 
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="bg-black/40 backdrop-blur-3xl border border-white/10 p-2 rounded-[2rem] flex items-center gap-2 pointer-events-auto"
                  >
                     <div className="px-6 py-2">
                        <span className="text-white text-[13px] font-black tracking-tight">智能定位：第 {showOriginalPaper === 'q1' ? '1' : '2'} 题</span>
                     </div>
                     <div className="w-px h-4 bg-white/20" />
                     <button className="p-3 text-white/60 hover:text-white active:scale-90 transition-transform">
                        <Maximize size={20} />
                     </button>
                  </motion.div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isEditing && (
            <>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsEditing(false)}
                className="absolute inset-0 bg-black/60 backdrop-blur-md z-[200]"
              />
              <motion.div 
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 30, stiffness: 300, mass: 0.8 }}
                className="absolute bottom-0 left-0 right-0 bg-[#F2F2F7] rounded-t-[2.5rem] z-[201] flex flex-col max-h-[92vh] overflow-hidden"
              >
                {/* Visual Handle */}
                <div className="w-10 h-1.5 bg-gray-300/30 rounded-full mx-auto mt-3 mb-2" />
                
                {/* Header */}
                <div className="px-6 py-4 flex items-center justify-between bg-white border-b border-gray-100/50 rounded-t-[2.5rem]">
                  <button 
                    onClick={() => setIsEditing(false)}
                    className="text-[15px] font-medium text-gray-400 active:opacity-60 px-2"
                  >
                    取消
                  </button>
                  <h3 className="text-[17px] font-bold text-gray-900">编辑题目</h3>
                  <button 
                    onClick={() => setIsEditing(false)}
                    className="text-[15px] font-bold text-blue-600 active:opacity-60 px-2"
                  >
                    保存
                  </button>
                </div>

                {/* Tabs */}
                <div className="flex bg-white px-2 border-b border-gray-50">
                  {[
                    { id: 'content', label: '题干' },
                    { id: 'answer', label: '答案' }
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setEditTab(tab.id as any)}
                      className={`flex-1 py-4 text-[14px] font-bold relative transition-colors ${
                        editTab === tab.id ? 'text-blue-600' : 'text-gray-400'
                      }`}
                    >
                      {tab.label}
                      {editTab === tab.id && (
                        <motion.div 
                          layoutId="edit-tab-underline"
                          className="absolute bottom-0 left-0 right-0 h-[3px] bg-blue-600 rounded-full mx-auto w-12"
                        />
                      )}
                    </button>
                  ))}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {editTab === 'content' && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="space-y-4"
                    >
                      <div className="bg-white rounded-3xl p-6 shadow-sm mb-4">
                        <div className="flex gap-4">
                          {/* Text Area - Larger portion */}
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-[13px] font-bold text-gray-900">题目内容</span>
                              <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-black uppercase tracking-tight">
                                {editingQuestion?.type}
                              </span>
                            </div>
                            <textarea 
                              key={editingQuestion?.id}
                              className="w-full text-[15px] text-gray-800 bg-transparent border-none focus:ring-0 resize-none leading-relaxed min-h-[120px] placeholder:text-gray-300"
                              defaultValue={editingQuestion?.content}
                            />
                            <div className="flex justify-end mt-1">
                              <span className="text-[10px] text-gray-300 font-bold tracking-tight uppercase">
                                {editingQuestion?.content?.length || 0}/500
                              </span>
                            </div>

                            {/* Knowledge Points Editor */}
                            <div className="mt-4 pt-4 border-t border-gray-50">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[12px] font-bold text-gray-900">知识点</span>
                                <button className="text-[10px] font-bold text-blue-600 flex items-center gap-1">
                                  <Plus size={10} /> 添加知识点
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {editingQuestion?.knowledgePoints?.map((kp, i) => (
                                  <span key={i} className="px-2 py-0.5 rounded-full bg-slate-50 text-slate-500 text-[10px] font-bold border border-slate-100 flex items-center gap-1">
                                    #{kp}
                                    <X size={10} className="hover:text-red-500 cursor-pointer" onClick={() => {}} />
                                  </span>
                                ))}
                                {(!editingQuestion?.knowledgePoints || editingQuestion.knowledgePoints.length === 0) && (
                                  <span className="text-[10px] text-gray-300 italic">暂无知识点</span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Integrated Illustration - More compact */}
                          <div className="w-[140px] shrink-0">
                            <div 
                              onClick={() => setShowCropTool(true)}
                              className="group relative aspect-square rounded-2xl overflow-hidden bg-gray-50 border border-gray-100 flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
                            >
                              <img 
                                src={editingQuestion?.type === '选择题' 
                                  ? "https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=300&h=300&fit=crop"
                                  : "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=300&h=300&fit=crop"
                                } 
                                className="w-full h-full object-contain p-2"
                                alt="Question illustration"
                              />
                              <div className="absolute inset-0 bg-blue-600/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center text-blue-600 shadow-lg">
                                  <Camera size={14} />
                                </div>
                              </div>
                            </div>
                            <p className="text-center text-[10px] text-blue-600 font-black mt-2 uppercase tracking-tighter">更换图片</p>
                          </div>
                        </div>

                        {/* --- Crop/Upload Menu --- */}
                        <AnimatePresence>
                          {showCropTool && (
                            <div className="fixed inset-0 z-[800] flex items-end">
                              <motion.div 
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={() => setShowCropTool(false)}
                                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                              />
                              <motion.div 
                                initial={{ y: '100%' }}
                                animate={{ y: 0 }}
                                exit={{ y: '100%' }}
                                className="relative w-full max-w-sm mx-auto bg-white rounded-t-[2.5rem] p-6 pb-12 shadow-2xl"
                              >
                                <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-6" />
                                <h3 className="text-center text-[14px] font-black text-gray-900 mb-5">更换题目插图</h3>
                                <div className="grid grid-cols-2 gap-3 max-w-[320px] mx-auto">
                                  <button className="flex flex-col items-center gap-2 p-3.5 rounded-2xl bg-blue-50/50 border border-blue-100 active:scale-95 transition-transform">
                                    <div className="w-9 h-9 bg-white rounded-xl shadow-sm flex items-center justify-center text-blue-600">
                                      <Maximize size={18} />
                                    </div>
                                    <p className="text-[12px] font-bold text-gray-900">从原卷裁剪</p>
                                  </button>
                                  <button className="flex flex-col items-center gap-2 p-3.5 rounded-2xl bg-gray-50/50 border border-gray-100 active:scale-95 transition-transform">
                                    <div className="w-9 h-9 bg-white rounded-xl shadow-sm flex items-center justify-center text-gray-400">
                                      <Camera size={18} />
                                    </div>
                                    <p className="text-[12px] font-bold text-gray-900">拍照上传</p>
                                  </button>
                                </div>
                              </motion.div>
                            </div>
                          )}
                        </AnimatePresence>

                        {/* Multiple Choice Options List */}
                        {editingQuestion?.type === '选择题' && (
                          <div className="mt-8">
                            <div className="flex items-center justify-between mb-4">
                              <span className="text-[13px] font-bold text-gray-900">选项 (单选)</span>
                              <button className="text-[11px] font-bold text-blue-600 flex items-center gap-1">
                                <Plus size={12} /> 添加选项
                              </button>
                            </div>
                            <div className="space-y-2">
                              {[
                                { label: 'A', value: 'CD / AC' },
                                { label: 'B', value: 'BD / CB' },
                                { label: 'C', value: 'CD / CB' },
                                { label: 'D', value: 'CB / AB' }
                              ].map((opt) => (
                                <div key={opt.label} className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center text-[13px] font-bold text-gray-400 border border-gray-100">
                                    {opt.label}
                                  </div>
                                  <div className="flex-1 px-4 py-3 bg-gray-50 rounded-xl text-[14px] text-gray-800 font-medium">
                                    {opt.value}
                                  </div>
                                  <button className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-red-400">
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                  
                  {editTab === 'answer' && (
                    <motion.div 
                      key="answer-tab"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-3"
                    >
                      <div className="bg-white rounded-2xl p-4 shadow-sm">
                        <div className="flex gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <span className="w-1 h-1 rounded-full bg-gray-300" />
                              <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">学生内容</span>
                            </div>
                            <div className="px-3 py-2 bg-gray-50 rounded-xl text-[13px] text-gray-500 italic border border-gray-100/50">
                               y = 2x + 1
                            </div>
                          </div>

                          <div className="flex-1">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <span className="w-1 h-1 rounded-full bg-blue-500" />
                              <span className="text-[10px] font-black text-blue-600 uppercase tracking-wider">标准答案</span>
                            </div>
                            <div className="px-3 py-2 bg-blue-50/30 rounded-xl text-[13px] text-gray-900 font-bold border border-blue-100/30">
                               y = -x + 5
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white rounded-3xl p-6 shadow-sm mb-4">
                        <h4 className="text-[14px] font-bold text-gray-900 mb-3 flex items-center gap-2">
                          <Sparkles size={14} className="text-blue-500" />
                          题目解析 (选填)
                        </h4>
                        <textarea 
                          className="w-full text-[14px] text-gray-600 bg-transparent border-none focus:ring-0 resize-none leading-relaxed min-h-[220px] placeholder:text-gray-200"
                          placeholder="请输入详细的 AI 解析内容或手动编辑解析内容..."
                        />
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* Footer Actions */}
                <div className="px-6 pt-4 pb-12 bg-white/80 backdrop-blur-xl border-t border-gray-100 flex gap-3">
                  <button 
                    onClick={() => setIsEditing(false)}
                    className="flex-1 py-4 bg-gray-50 text-gray-500 font-bold rounded-2xl active:scale-95 transition-transform"
                  >
                    取消
                  </button>
                  <button 
                    onClick={() => setIsEditing(false)}
                    className="flex-[2] py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-xl shadow-blue-100 active:scale-95 transition-transform"
                  >
                    保存
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

      </div>

      {/* Question Detail View Modal */}
      <AnimatePresence>
        {viewingQuestion && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[400] flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => setViewingQuestion(null)}
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              className="w-full max-w-md bg-white rounded-t-[2.5rem] sm:rounded-[2.5rem] p-8 pb-10 flex flex-col gap-6 overflow-y-auto max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-500 text-[10px] font-black uppercase tracking-widest">{viewingQuestion.subject}</span>
                  <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-400 text-[10px] font-black uppercase tracking-widest">{viewingQuestion.type}</span>
                </div>
                <button 
                  onClick={() => setViewingQuestion(null)}
                  className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 active:scale-90 transition-transform"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-6">
                {/* AI Judgment Status - Hide in Bank Tab */}
                {activeTab === 'confirm' && (
                  <div className={`p-4 rounded-2xl flex items-center justify-between ${
                    viewingQuestion.isSuspicious ? 'bg-red-50/50 border border-red-100' : 'bg-green-50/50 border border-green-100'
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        viewingQuestion.isSuspicious ? 'bg-red-500 text-white' : 'bg-green-500 text-white'
                      }`}>
                        {viewingQuestion.isSuspicious ? <XCircle size={16} strokeWidth={3} /> : <CheckCircle2 size={16} strokeWidth={3} />}
                      </div>
                      <div>
                        <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-0.5">AI 批改建议</p>
                        <p className={`text-[15px] font-black ${
                          viewingQuestion.isSuspicious ? 'text-red-500' : 'text-green-500'
                        }`}>
                          {viewingQuestion.isSuspicious ? '该题疑似做错' : '该题判定为正确'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <div className="text-[17px] leading-relaxed text-gray-900 font-medium whitespace-pre-wrap font-serif">
                    {viewingQuestion.content}
                  </div>

                  {/* Options List with Dynamic Grid */}
                  {viewingQuestion.options && viewingQuestion.options.length > 0 && (
                    <div className={`grid gap-3 mt-4 ${
                      viewingQuestion.options.every(opt => opt.length < 10) ? 'grid-cols-2' : 
                      viewingQuestion.options.every(opt => opt.length < 20) ? 'grid-cols-1' : 'grid-cols-1'
                    }`}>
                      {viewingQuestion.options.map((option, i) => (
                        <div key={i} className="px-4 py-3 rounded-xl bg-gray-50 border border-gray-100 text-[14px] font-medium text-gray-700 font-serif">
                          {option}
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <div className="w-full aspect-video rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden">
                     <img 
                       src="https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=600&h=400&fit=crop" 
                       className="w-full h-full object-contain p-4"
                       alt=""
                     />
                  </div>

                  <div className="flex flex-wrap gap-2">
                     {viewingQuestion.knowledgePoints?.map((kp, i) => (
                       <span key={i} className="px-3 py-1 rounded-full bg-slate-50 text-slate-400 text-[11px] font-bold border border-slate-100 uppercase tracking-tight">
                         #{kp}
                       </span>
                     ))}
                  </div>
                </div>
              </div>

              {/* Actions Section */}
              <div className="pt-4 border-t border-gray-50">
                {activeTab === 'confirm' ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center gap-1.5 mb-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">人工判定纠错</p>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <button 
                        onClick={() => setViewingQuestion(null)}
                        className="flex flex-col items-center justify-center py-4 rounded-3xl bg-green-50 border border-green-100 text-green-600 active:scale-95 transition-all gap-1"
                      >
                        <CheckCircle2 size={24} strokeWidth={2.5} />
                        <span className="text-[12px] font-black uppercase">确认做对</span>
                      </button>
                      <button 
                        onClick={() => setViewingQuestion(null)}
                        className="flex flex-col items-center justify-center py-4 rounded-3xl bg-red-50 border border-red-100 text-red-500 active:scale-95 transition-all gap-1"
                      >
                        <XCircle size={24} strokeWidth={2.5} />
                        <span className="text-[12px] font-black uppercase">确认为错</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => {
                          setEditingQuestion(viewingQuestion);
                          setIsEditing(true);
                          setViewingQuestion(null);
                        }}
                        className="flex-1 py-4 flex items-center justify-center gap-2 text-gray-400 font-bold text-[13px] hover:text-blue-500"
                      >
                        <Edit3 size={16} /> 编辑题目
                      </button>
                      <div className="w-px h-6 bg-gray-100" />
                      <button 
                        onClick={() => {
                          setShowDeleteConfirm(viewingQuestion.id);
                          setViewingQuestion(null);
                        }}
                        className="flex-1 py-4 flex items-center justify-center gap-2 text-gray-400 font-bold text-[13px] hover:text-red-500"
                      >
                        <Trash2 size={16} /> 删除题目
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-4">
                      <button 
                        onClick={() => {
                          // Mock print action
                          setViewingQuestion(null);
                        }}
                        className="flex items-center justify-center gap-2 py-4 rounded-3xl bg-blue-600 text-white active:scale-95 transition-all shadow-lg shadow-blue-100"
                      >
                        <Printer size={18} />
                        <span className="text-[14px] font-black uppercase">进入打印</span>
                      </button>
                      <button 
                        onClick={() => {
                          setShowDeleteConfirm(viewingQuestion.id);
                          setViewingQuestion(null);
                        }}
                        className="flex items-center justify-center gap-2 py-4 rounded-3xl bg-red-50 text-red-500 active:scale-95 transition-all border border-red-100"
                      >
                        <Trash2 size={18} />
                        <span className="text-[14px] font-black uppercase">从错题本移除</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Batch Action Bar - Centered floating capsule */}
      <AnimatePresence>
        {selectedQuestions.length > 0 && (
          <div className="fixed bottom-[100px] left-0 right-0 z-[300] flex justify-center pointer-events-none">
            <div className="w-full max-w-md px-6 flex justify-center">
              <motion.div
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 100, opacity: 0 }}
                className="bg-slate-900/95 backdrop-blur-md rounded-full py-2.5 px-3 flex items-center gap-4 shadow-2xl shadow-slate-900/40 border border-white/10 w-full max-w-[340px] pointer-events-auto"
              >
                <div className="flex items-center gap-3 pl-2">
                  <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-[12px] font-black text-white shadow-lg shadow-blue-500/20">
                    {selectedQuestions.length}
                  </div>
                  <span className="text-[13px] font-black text-white/90 tracking-tight whitespace-nowrap">项已选</span>
                </div>
                
                <div className="flex items-center gap-1 ml-auto">
                  <button 
                    onClick={() => setSelectedQuestions([])}
                    className="px-4 py-2 text-[12px] font-black text-white/40 hover:text-white transition-colors uppercase tracking-wider"
                  >
                    取消
                  </button>
                  <button 
                    onClick={() => {
                      if (activeTab === 'bank') {
                        setIsPrintPreviewOpen(true);
                      } else {
                        // Actual state update
                        setQuestions(prev => prev.map(q => 
                          selectedQuestions.includes(q.id) 
                            ? { ...q, status: 'unmastered' as const } 
                            : q
                        ));
                        setSelectedQuestions([]);
                        setActiveTab('bank');
                      }
                    }}
                    className="px-6 py-2.5 bg-blue-600 text-white rounded-full text-[11px] font-black active:scale-95 transition-all shadow-xl shadow-blue-500/20 flex items-center gap-2 whitespace-nowrap"
                  >
                    {activeTab === 'bank' ? (
                      <><Printer size={14} strokeWidth={3} /> <span>组题预览</span></>
                    ) : (
                      <><Download size={14} strokeWidth={3} /> <span>批量加入</span></>
                    )}
                  </button>
                </div>
              </motion.div>
            </div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
