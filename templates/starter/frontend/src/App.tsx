import { useState } from 'react';

export function App() {
  const [count, setCount] = useState(0);
  return (
    <main>
      <h1>&lt;PROJECT_NAME&gt;</h1>
      <p>Starter template — replace with your app.</p>
      <button onClick={() => setCount(c => c + 1)}>clicked {count} times</button>
    </main>
  );
}
