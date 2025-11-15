import React from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import Ticker from './Ticker';
import MessageModal from '../common/MessageModal';

function Layout() {
  return (
    <>
      <Navbar />
    
      <Ticker /> 

      <main className="main-container">
        <Outlet />
      </main>

      <MessageModal />
    </>
  );
}

export default Layout;