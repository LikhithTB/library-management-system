const config = {
  // Keep API requests same-origin. Create React App proxies /api in development,
  // and nginx proxies it to the backend in the Docker deployment.
  API_URL: (process.env.REACT_APP_API_URL || "").trim().replace(/\/+$/, ""),
  APP_NAME: "Library Management System",
  STUDENT_EMAIL_IDENTIFIER: ".stu",
  NON_STUDENT_ROLES: ["librarian", "hod", "staff"],
  ROLES_REQUIRING_HOD_APPROVAL: ["librarian", "staff"],
  ROLES_REQUIRING_ADMIN_APPROVAL: ["hod"],
  BOOK_ISSUE_DAYS: 14,
  MAX_FREE_RENEWALS: 2,
  MAX_BOOKS_PER_STUDENT: 3,
  RENEWAL_WINDOW_DAYS: 5,
  FINE_PER_DAY: 5,
  DUE_SOON_ALERT_DAYS: 3,
};

export default config;
