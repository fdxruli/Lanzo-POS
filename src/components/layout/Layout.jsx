import React from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import Ticker from './Ticker';

function Layout() {
  return (
    <>
      <Navbar />
    
      <Ticker /> 

      <main className="main-container">
        <Outlet />
      </main>
    </>
  );
}

export default Layout;