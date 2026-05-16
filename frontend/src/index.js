import React from 'react';
import ReactDOM from 'react-dom/client';
import { installUnhandledAxiosRejectionHandler } from './apiErrorHandling';
import App from './App';
import './index.css';

installUnhandledAxiosRejectionHandler();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
