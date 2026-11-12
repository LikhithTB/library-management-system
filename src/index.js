import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

// Attach the login token to every API call. The backend rejects anonymous
// requests, so this runs before any component fetches data. A 401 from the
// API means the session has ended; App.js listens for that and logs out.
const originalFetch = window.fetch.bind(window);
const AUTH_EXEMPT_PATHS = new Set(['/api/login', '/api/register']);

window.fetch = (input, init = {}) => {
  const rawUrl = typeof input === 'string' ? input : input.url;
  let path = '';
  try {
    path = new URL(rawUrl, window.location.origin).pathname;
  } catch (e) {
    path = '';
  }
  if (!path.startsWith('/api/') || AUTH_EXEMPT_PATHS.has(path)) {
    return originalFetch(input, init);
  }

  const token = localStorage.getItem('lms_token');
  const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return originalFetch(input, { ...init, headers }).then((res) => {
    if (res.status === 401 && token) {
      window.dispatchEvent(new Event('lms:session-expired'));
    }
    return res;
  });
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
