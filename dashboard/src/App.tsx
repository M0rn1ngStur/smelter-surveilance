import { useState } from 'react';
import { Navbar } from './components/Navbar';
import { Layout } from './components/Layout';
import { RecordingsList } from './components/RecordingsList';

function App() {
  const [page, setPage] = useState('monitoring');

  return (
    <div className="min-h-screen bg-sentinel-bg">
      <Navbar currentPage={page} onNavigate={setPage} />
      {page === 'monitoring' && <Layout />}
      {page === 'recordings' && <RecordingsList />}
    </div>
  );
}

export default App;
