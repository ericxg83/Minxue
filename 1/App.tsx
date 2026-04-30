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
  QrCode,
  Printer,
  X,
  Trash2,
  ChevronDown
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
  status: 'pending' | 'correct' | 'unmastered' | 'mastered';
  date: string;
  errorCount: number;
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
  {
    id: 'q1',
    type: '解答题',
    subject: '数学',
    isSuspicious: true,
    status: 'pending',
    date: '2026-04-29',
    errorCount: 1,
    content: '已知直线 l 与直线 y=2x+1 的交点的横坐标为 2，与直线 y=-x+2 的交点的纵坐标为 1，求直线 l 的函数表达式。'
  },
  {
    id: 'q2',
    type: '选择题',
    subject: '数学',
    isSuspicious: false,
    status: 'pending',
    date: '2026-04-28',
    errorCount: 1,
    content: '在等差数列 {an} 中，a1=2, a3=6，则公差 d 为多少？'
  },
  {
    id: 'q3',
    type: '解答题',
    subject: '语文',
    isSuspicious: false,
    status: 'correct',
    date: '2026-04-27',
    errorCount: 2,
    content: '请结合全文，分析文中“那一抹阳光”在情感表达上的作用。'
  },
  {
    id: 'q4',
    type: '选择题',
    subject: '物理',
    isSuspicious: false,
    status: 'correct',
    date: '2026-04-26',
    errorCount: 3,
    content: '关于重力，下列说法正确的是：'
  },
  {
    id: 'q5',
    type: '填空题',
    subject: '化学',
    isSuspicious: false,
    status: 'unmastered',
    date: '2026-04-25',
    errorCount: 1,
    content: '写出电解水的化学方程式：____________________'
  },
  {
    id: 'q6',
    type: '简答题',
    subject: '生物',
    isSuspicious: false,
    status: 'mastered',
    date: '2026-04-24',
    errorCount: 2,
    content: '简述光合作用和呼吸作用的区别与联系。'
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
  const [editTab, setEditTab] = useState<'content' | 'image' | 'answer'>('content');

  const filteredRecords = MOCK_RECORDS.filter(r => 
    activeStatus === 'all' ? true : (activeStatus === 'done' ? r.status === 'done' : activeStatus === 'failed' ? r.status === 'failed' : r.status === 'processing')
  );

  const filteredQuestions = MOCK_QUESTIONS.filter(q => {
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
              <QrCode size={20} strokeWidth={2.5} />
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
                {/* --- Segmented Filters --- */}
                <section className="px-5 pt-4 mb-5 overflow-x-auto no-scrollbar">
                  <div className="flex gap-2 min-w-max">
                    {[
                      { id: 'all', label: '全部待确认', count: MOCK_QUESTIONS.filter(q => q.status === 'pending' || q.status === 'correct' || q.isSuspicious).length },
                      { id: 'suspicious', label: '疑似错题', count: MOCK_QUESTIONS.filter(q => q.isSuspicious).length },
                      { id: 'correct', label: '识别正确', count: MOCK_QUESTIONS.filter(q => q.status === 'correct' && !q.isSuspicious).length }
                    ].map((filter) => (
                      <button
                        key={filter.id}
                        onClick={() => setConfirmFilter(filter.id as ConfirmFilter)}
                        className={`px-5 py-2.5 rounded-full text-[13px] font-bold flex items-center gap-2 transition-all ${
                          confirmFilter === filter.id 
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-100'
                          : 'bg-gray-100/80 text-gray-400'
                        }`}
                      >
                        {filter.label}
                        <span className={`text-[11px] font-medium ${
                          confirmFilter === filter.id ? 'text-white/80' : 'text-gray-300'
                        }`}>
                          {filter.count}
                        </span>
                      </button>
                    ))}
                  </div>
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
                      onClick={() => toggleSelect(q.id)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-bold text-gray-300 italic">#{idx + 1}</span>
                          <span className={`px-2 py-0.5 rounded-lg text-[9px] font-bold tracking-tight uppercase ${
                            q.isSuspicious ? 'bg-red-50 text-red-500 border border-red-100' : 'bg-green-50 text-green-500 border border-green-100'
                          }`}>
                            {q.isSuspicious ? '疑似错题' : '识别正确'}
                          </span>
                          <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{q.type}</span>
                        </div>
                        <div className={`w-5 h-5 rounded-full border-[1.5px] flex items-center justify-center transition-all ${
                          selectedQuestions.includes(q.id) ? 'bg-blue-600 border-blue-600' : 'border-gray-100'
                        }`}>
                          {selectedQuestions.includes(q.id) && <CheckCircle2 size={12} className="text-white" strokeWidth={4} />}
                        </div>
                      </div>

                      <div className="text-[14px] leading-snug text-gray-700 mb-4 px-1">
                        {q.content}
                      </div>

                      <div className="flex items-center justify-between border-t border-gray-50 pt-3">
                        <button className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400 hover:text-blue-600 transition-colors">
                          <BookOpen size={13} strokeWidth={2.5} /> 查看原图
                        </button>
                        <div className="flex items-center gap-4">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingQuestion(q);
                              setIsEditing(true);
                            }}
                            className="text-[11px] font-bold text-gray-400 hover:text-blue-500 active:opacity-60"
                          >
                            编辑
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              // Delete logic could go here
                            }}
                            className="text-[11px] font-bold text-gray-400 hover:text-red-500 active:opacity-60"
                          >
                            删除
                          </button>
                        </div>
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
                {/* Primary State Tabs --- */}
                <div className="flex gap-2 px-5 pt-4 overflow-x-auto no-scrollbar">
                  {[
                    { id: 'all', label: '全部', count: MOCK_QUESTIONS.filter(q => q.status === 'unmastered' || q.status === 'mastered').length },
                    { id: 'unmastered', label: '未掌握', count: MOCK_QUESTIONS.filter(q => q.status === 'unmastered').length },
                    { id: 'mastered', label: '已掌握', count: MOCK_QUESTIONS.filter(q => q.status === 'mastered').length }
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setBankFilter(tab.id as BankFilter)}
                      className={`px-5 py-2.5 rounded-full text-[13px] font-bold transition-all whitespace-nowrap flex items-center gap-2 ${
                        bankFilter === tab.id 
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-100'
                        : 'bg-white text-gray-400 border border-gray-100'
                      }`}
                    >
                      {tab.label}
                      <span className={`text-[11px] font-medium ${
                        bankFilter === tab.id ? 'text-white/80' : 'text-gray-300'
                      }`}>
                        {tab.count}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Sub-Filters - Dropdown Style */}
                <div className="px-5 mt-4 flex gap-2 overflow-x-auto no-scrollbar">
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
                      onClick={() => toggleSelect(q.id)}
                      className={`bg-white rounded-2xl p-5 shadow-sm border-2 transition-all relative ${
                        selectedQuestions.includes(q.id) ? 'border-blue-500 shadow-blue-50' : 'border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <div className={`w-5 h-5 rounded-full border-[1.5px] flex items-center justify-center transition-all ${
                             selectedQuestions.includes(q.id) ? 'bg-blue-600 border-blue-600' : 'border-gray-200'
                          }`}>
                            {selectedQuestions.includes(q.id) && <CheckCircle2 size={12} className="text-white" strokeWidth={3} />}
                          </div>
                          <span className="text-[12px] font-bold text-gray-400">{q.subject} · {q.type}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] text-gray-300 font-medium">{q.date}</span>
                          <span className={`px-2 py-0.5 rounded-lg text-[9px] font-bold uppercase tracking-tight ${
                            q.status === 'unmastered' ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-500'
                          }`}>
                            {q.status === 'unmastered' ? '未掌握' : '已掌握'}
                          </span>
                        </div>
                      </div>
                      <div className="text-[14px] leading-relaxed text-gray-700 mb-4 px-1">
                        {q.content}
                      </div>
                      <div className="text-[11px] text-gray-300 font-bold px-1 flex items-center gap-1.5 pt-3 border-t border-gray-50">
                        <XCircle size={12} className="text-red-200" /> 错误次数: <span className="text-red-400 underline decoration-red-100 underline-offset-2">{q.errorCount}次</span>
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
                      className={`px-5 py-2.5 rounded-full text-[13px] font-bold transition-all whitespace-nowrap flex items-center gap-2 ${
                        examFilter === tab.id 
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-100'
                        : 'bg-gray-100/80 text-gray-400'
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
                <div className="px-5 mt-6 space-y-4">
                  {filteredPapers.map((paper) => (
                    <div 
                      key={paper.id}
                      onClick={() => setSelectedPaperId(paper.id)}
                      className={`bg-white rounded-[2rem] p-5 shadow-sm border-2 transition-all relative group ${
                        selectedPaperId === paper.id ? 'border-blue-500 shadow-xl shadow-blue-100/50' : 'border-transparent'
                      }`}
                    >
                      <div className="flex gap-4">
                        {/* Thumbnail */}
                        <div className="relative w-24 h-24 shrink-0 rounded-2xl overflow-hidden bg-gray-50 border border-gray-100">
                          <img src={paper.thumbnail} className="w-full h-full object-cover" alt="" />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <h4 className="text-[14px] font-black text-gray-900 truncate pr-2 tracking-tight">
                                {paper.name}
                              </h4>
                              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                                 selectedPaperId === paper.id ? 'bg-blue-600 border-blue-600' : 'border-gray-200'
                              }`}>
                                {selectedPaperId === paper.id && <div className="w-2 h-2 bg-white rounded-full" />}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 text-gray-400">
                              <div className="flex items-center gap-1">
                                <Search size={12} className="opacity-50" />
                                <span className="text-[11px] font-bold">{paper.timestamp}</span>
                              </div>
                              <span className="text-[11px] font-bold tracking-tight">题目数: {paper.count}题</span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black tracking-tight ${
                              paper.status === 'unprocessed' ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-500'
                            }`}>
                              {paper.status === 'unprocessed' ? '未批改' : '已批改'}
                            </span>
                            
                            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-blue-100 bg-blue-50/50 text-blue-600 hover:bg-blue-50 transition-colors active:scale-95">
                              <Printer size={12} />
                              <span className="text-[11px] font-black">重打印</span>
                            </button>
                          </div>
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
              initial={{ opacity: 0, scale: 1.1 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="fixed inset-0 bg-[#F2F2F7] z-[200] flex flex-col max-w-md mx-auto h-screen overflow-hidden"
            >
              <div className="flex-1 overflow-y-auto bg-white px-8 pt-12 pb-32">
                <button 
                  onClick={() => setIsPrintPreviewOpen(false)}
                  className="absolute top-12 left-6 w-8 h-8 bg-slate-900/5 rounded-full flex items-center justify-center text-slate-900 backdrop-blur-md active:scale-90 transition-transform"
                >
                  <ChevronRight size={20} className="rotate-180" />
                </button>

                {/* Print Preview Header */}
                <div className="flex justify-between items-center mb-8 border-b-2 border-slate-900 pb-4 mt-8">
                  <div className="bg-slate-900 text-white px-2 py-0.5 text-[9px] font-bold rounded tracking-widest uppercase">Print Preview</div>
                  <h3 className="text-[18px] font-black tracking-tight text-slate-800">{currentStudent.name} - 错题重练卷</h3>
                  <div className="w-12 h-12 bg-gray-50 flex items-center justify-center rounded-xl border border-gray-100">
                    <LayoutGrid size={20} className="text-gray-300" />
                  </div>
                </div>

                <div className="flex justify-center gap-12 text-[12px] font-bold text-gray-400 mb-8 border-b border-gray-50 pb-4">
                  <span>总题数: {selectedQuestions.length || 1} 题</span>
                  <span>满分: 100 分</span>
                  <span>限时: 60 分钟</span>
                </div>

                <div className="grid grid-cols-2 gap-12 mb-12">
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="font-bold text-slate-400 uppercase text-[10px] tracking-widest">Name:</span>
                    <div className="flex-1 border-b border-dotted border-gray-200 pt-4" />
                  </div>
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="font-bold text-slate-400 uppercase text-[10px] tracking-widest">Date:</span>
                    <div className="flex-1 border-b border-dotted border-gray-200 pt-4" />
                  </div>
                </div>

                {/* Exam Questions */}
                <div className="space-y-12">
                  {(selectedQuestions.length > 0 ? MOCK_QUESTIONS.filter(q => selectedQuestions.includes(q.id)) : MOCK_QUESTIONS.slice(0, 1)).map((q, i) => (
                    <div key={q.id} className="relative">
                      <div className="flex items-start gap-4 mb-6">
                        <span className="text-[16px] font-black mt-1 text-slate-900">{i + 1}.</span>
                        <div className="flex flex-col gap-2">
                          <span className="text-[10px] text-gray-300 font-bold uppercase tracking-widest">({q.type})</span>
                          <div className="text-[15px] leading-relaxed text-slate-800 font-medium">{q.content}</div>
                        </div>
                      </div>
                      <div className="w-full h-48 border border-gray-100 rounded-2xl bg-gray-50/20 flex flex-col items-center justify-center relative overflow-hidden group font-serif italic text-gray-300">
                         <div className="absolute top-4 left-6 text-[12px]">答:</div>
                         <div className="w-full h-full border-t border-gray-50 mt-10" />
                         <div className="w-full h-full border-t border-gray-50" />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-32 pt-8 border-t border-gray-100 text-center pb-12">
                  <p className="text-[10px] text-gray-300 font-bold uppercase tracking-[0.3em]">敏学错题本 · 智能学习助手</p>
                  <p className="text-[10px] text-gray-300 mt-2 font-mono tracking-tighter">PAGE 01 / 01</p>
                </div>
              </div>

              <div className="absolute bottom-0 left-0 right-0 p-6 bg-white/90 backdrop-blur-xl border-t border-gray-100 flex gap-4 z-[210]">
                <button className="flex-1 py-4 border-2 border-blue-50 px-4 rounded-2xl text-[14px] font-bold text-blue-600 active:scale-95 transition-transform bg-white">PDF 导出</button>
                <button className="flex-[2] py-4 bg-blue-600 text-white rounded-2xl text-[14px] font-bold shadow-xl shadow-blue-100 active:scale-95 transition-transform">直接打印</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
          </AnimatePresence>
        </main>

        {/* --- Batch Action Toolbar --- */}
        <AnimatePresence>
          {(selectedQuestions.length > 0 && (activeTab === 'confirm' || activeTab === 'bank')) && (
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="fixed bottom-28 left-0 right-0 max-w-md mx-auto px-5 z-[80]"
            >
              <div className="bg-slate-900/95 backdrop-blur-3xl rounded-[2rem] p-5 flex items-center justify-between shadow-2xl border border-white/10 ring-1 ring-white/10">
                <div className="pl-1">
                  <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">已选题目</p>
                  <p className="text-[15px] font-bold text-white">共 {selectedQuestions.length} 道</p>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setIsPrintPreviewOpen(true)}
                    className="px-6 py-3 rounded-2xl text-[12px] font-black text-white bg-blue-600 hover:bg-blue-500 transition-all shadow-xl shadow-blue-900/50"
                  >
                    {activeTab === 'bank' ? `打印 (${selectedQuestions.length})` : '批量加入错题本'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
                className="absolute inset-0 bg-black/50 backdrop-blur-sm z-[100]"
              />
              <motion.div 
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 28, stiffness: 220 }}
                className="absolute bottom-0 left-0 right-0 bg-[#F2F2F7] rounded-t-[3.5rem] z-[101] px-6 pt-3 pb-12 shadow-2xl"
              >
                <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6" />
                <div className="flex justify-between items-center mb-8 px-2">
                  <h3 className="text-[20px] font-black text-gray-900 tracking-tight">切换学习档案</h3>
                  <button onClick={() => setShowStudentSwitcher(false)} className="p-2 bg-white rounded-full text-gray-400 shadow-sm transition-transform active:scale-90">
                    <X size={20} strokeWidth={3} />
                  </button>
                </div>
                <div className="space-y-3 px-1">
                  {MOCK_STUDENTS.map(student => (
                    <button
                      key={student.id}
                      onClick={() => { setCurrentStudent(student); setShowStudentSwitcher(false); }}
                      className={`w-full flex items-center justify-between p-5 rounded-[2.5rem] transition-all border-2 ${
                        student.id === currentStudent.id 
                        ? 'bg-blue-600 border-blue-500 shadow-xl shadow-blue-100 text-white' 
                        : 'bg-white border-transparent text-gray-900 shadow-sm hover:border-blue-100'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center font-black text-[18px] ${
                          student.id === currentStudent.id ? 'bg-white/20' : 'bg-blue-50 text-blue-600'
                        }`}>{student.avatar}</div>
                        <div className="text-left">
                          <h4 className="font-black text-[16px] leading-tight">{student.name}</h4>
                          <p className={`text-[10px] font-bold tracking-[0.1em] uppercase leading-tight mt-1 ${student.id === currentStudent.id ? 'text-blue-100/70' : 'text-gray-400'}`}>{student.classInfo}</p>
                        </div>
                      </div>
                      {student.unreadCount && (
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black tracking-tighter ${
                          student.id === currentStudent.id ? 'bg-white text-blue-600' : 'bg-red-500 text-white'
                        }`}>
                          {student.unreadCount} 条新纪录
                        </span>
                      )}
                    </button>
                  ))}
                  <button className="w-full h-18 border-2 border-dashed border-gray-300 rounded-[2.5rem] text-blue-600 font-black text-[14px] flex items-center justify-center gap-3 mt-6 bg-white/50 hover:bg-white transition-all active:scale-95">
                    <Plus size={20} strokeWidth={3} />
                    <span>添加学生成员</span>
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* --- Edit Question Modal --- */}
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
                    { id: 'image', label: '插图' },
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
                      <div className="bg-white rounded-2xl p-5 shadow-sm border border-transparent">
                        <h4 className="text-[14px] font-bold text-gray-900 mb-3 px-1">题目内容</h4>
                        <div className="min-h-[140px]">
                          <textarea 
                            className="w-full min-h-[120px] bg-transparent text-[14px] font-medium text-slate-800 focus:outline-none resize-none placeholder:text-gray-300"
                            placeholder="请输入题目内容"
                            defaultValue={editingQuestion?.content}
                          />
                          <div className="text-right mt-2 border-t border-gray-50 pt-2">
                            <span className="text-[11px] text-gray-300 font-bold tracking-tight uppercase">0/500 characters</span>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white rounded-2xl p-5 shadow-sm">
                        <div className="flex justify-between items-center mb-4 px-1">
                          <h4 className="text-[14px] font-bold text-gray-900">选项 (单选)</h4>
                          <span className="text-[11px] text-gray-300 font-bold">共 0 个选项</span>
                        </div>
                        <button className="w-full py-4 rounded-xl border-2 border-dashed border-blue-50 bg-blue-50/10 text-blue-600 font-bold text-[13px] flex items-center justify-center gap-2 active:scale-95 transition-transform">
                          <Plus size={16} strokeWidth={3} />
                          添加选项
                        </button>
                      </div>
                    </motion.div>
                  )}
                  
                  {editTab === 'image' && (
                    <motion.div 
                      key="image-tab"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-white rounded-2xl p-10 flex flex-col items-center justify-center text-center shadow-sm"
                    >
                      <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                        <Camera size={32} strokeWidth={1} className="text-gray-300" />
                      </div>
                      <h4 className="text-[16px] font-bold text-gray-900 mb-2">暂无插图</h4>
                      <p className="text-[12px] text-gray-400 mb-8 max-w-[220px] mx-auto">
                        该题目尚未从原卷中截取插图，您可以点击下方拍照或从原卷手动截取
                      </p>
                      <button className="px-8 py-3.5 bg-blue-600 text-white rounded-2xl text-[14px] font-bold flex items-center gap-2 shadow-xl shadow-blue-100 active:scale-95 transition-all">
                        <Camera size={18} />
                        拍照上传插图
                      </button>
                    </motion.div>
                  )}

                  {editTab === 'answer' && (
                    <motion.div 
                      key="answer-tab"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-4"
                    >
                      <div className="bg-white rounded-3xl p-6 shadow-sm">
                        <h4 className="text-[14px] font-bold text-gray-900 mb-4 flex items-center gap-2">
                          正确答案
                        </h4>
                        <div className="h-32 bg-gray-50/50 rounded-2xl flex items-center justify-center border border-dashed border-gray-100">
                           <span className="text-gray-300 text-[13px] font-medium italic">暂无正确答案</span>
                        </div>
                      </div>

                      <div className="bg-white rounded-3xl p-6 shadow-sm">
                        <h4 className="text-[14px] font-bold text-gray-900 mb-3 px-1 font-sans">题目解析 (选填)</h4>
                        <textarea 
                          className="w-full min-h-[140px] bg-transparent text-[14px] text-gray-600 leading-relaxed focus:outline-none resize-none placeholder:text-gray-300 font-medium"
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

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
