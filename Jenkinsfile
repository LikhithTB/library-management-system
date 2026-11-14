pipeline {
  agent any
  options { timestamps(); disableConcurrentBuilds() }
  environment {
    VERCEL_TOKEN  = credentials('vercel-token')
    VERCEL_ORG_ID = credentials('vercel-org-id')
  }
  stages {
    stage('Backend: install and check') {
      steps {
        dir('backend') {
          sh '''
            python3 -m venv .venv
            . .venv/bin/activate
            pip install -r requirements.txt
            python -m compileall -q -x '\\.venv' .
          '''
        }
      }
    }
    stage('Frontend: test and build') {
      steps {
        sh 'npm ci'
        // No unit tests exist yet; passWithNoTests keeps this stage green.
        sh 'npm test -- --watchAll=false --passWithNoTests'
        // CI=true makes warnings fail the build, the same as a strict CI host.
        sh 'CI=true npm run build'
      }
    }
    stage('Database setup') {
      when { branch 'main' }
      environment {
        DATABASE_URL                = credentials('supabase-db-url')
        AUTH_SECRET_KEY             = credentials('auth-secret-key')
        CHATBOT_DB_PASSWORD         = credentials('chatbot-db-password')
        CHATBOT_STUDENT_DB_PASSWORD = credentials('chatbot-student-db-password')
        ADMIN_INITIAL_PASSWORD      = credentials('admin-initial-password')
      }
      steps {
        dir('backend') {
          sh '''
            . .venv/bin/activate
            python create_admin.py
            python migrate_password_hashes.py
            python migrate_account_status.py
            python migrate_graduation_year.py
            python setup_chatbot_db.py
          '''
        }
      }
    }
    stage('Deploy backend') {
      when { branch 'main' }
      environment { VERCEL_PROJECT_ID = credentials('vercel-backend-project-id') }
      steps {
        // Run from backend/ so Vercel uses backend/vercel.json and backend/index.py.
        dir('backend') {
          sh 'npx --yes vercel deploy --prod --yes --token "$VERCEL_TOKEN"'
        }
      }
    }
    stage('Deploy frontend') {
      when { branch 'main' }
      environment { VERCEL_PROJECT_ID = credentials('vercel-frontend-project-id') }
      steps {
        sh 'npx --yes vercel deploy --prod --yes --token "$VERCEL_TOKEN"'
      }
    }
  }
}
