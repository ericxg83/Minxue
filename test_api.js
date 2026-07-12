// Test to verify the API data matches our expectations
// This checks if the backend provides the data structure we expect

const testApiEndpoints = [
  'http://localhost:4000/api/generated-exams/student/fe09ef0b-530a-4583-bc6e-adeaecb96677',
  'http://localhost:4000/api/tasks/student/fe09ef0b-530a-4583-bc6e-adeaecb96677'
]

async function testApiEndpointsAndData() {
  try {
    // Test generated exams
    console.log('🔍 Testing generated-exams endpoint...')
    const examsResponse = await fetch(testApiEndpoints[0])
    if (examsResponse.ok) {
      const examsData = await examsResponse.json()
      console.log('✅ Generated exams:', examsData.success ? examsData.generatedExams.length : 0, 'exams found')

      if (examsData.generatedExams && examsData.generatedExams.length > 0) {
        const exam = examsData.generatedExams[0]
        console.log('📄 First exam:', exam.name, 'with', (exam.question_ids || []).length, 'questions')
        console.log('📄 Status:', exam.status)
        console.log('✅ Exam has required fields:', {
          id: !!exam.id,
          name: !!exam.name,
          question_ids: !!exam.question_ids,
          status: !!exam.status
        })
      }
    }

    // Test tasks
    console.log('\n🔍 Testing tasks endpoint...')
    const tasksResponse = await fetch(testApiEndpoints[1])
    if (tasksResponse.ok) {
      const tasksData = await tasksResponse.json()
      console.log('✅ Tasks:', tasksData.success ? tasksData.tasks.length : 0, 'tasks found')

      if (tasksData.tasks && tasksData.tasks.length > 0) {
        const taskWithExam = tasksData.tasks.find(t => t.generated_exam_id)
        console.log('📄 Task with generated_exam_id:', taskWithExam ? taskWithExam.original_name : 'None found')
        console.log('✅ Tasks data structure:', {
          total_tasks: tasksData.tasks.length,
          tasks_with_generated_exam: tasksData.tasks.filter(t => t.generated_exam_id).length,
          required_fields_present: tasksData.tasks.every(t => t.id && t.image_url)
        })
      }
    }

  } catch (error) {
    console.error('❌ API test failed:', error)
  }
}

testApiEndpointsAndData()