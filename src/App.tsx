import { useEffect } from 'react';

function App() {
  useEffect(() => {
    // Load Persona script
    const script = document.createElement('script');
    script.src = 'https://cdn.withpersona.com/dist/persona-v4.9.0.js';
    script.async = true;

    script.onload = () => {
      // Initialize Persona client after script loads
      const client = new window.Persona.Client({
        templateId: "itmpl_1sUZyGnyr37FxJVbcJioqM6x",
        environmentId: "env_p6vqJA4r8ztP3c6AHojQo",
        onReady: () => {
          console.log('Persona client ready, opening...');
          client.open();
        },
        onComplete: ({ inquiryId, status, fields }) => {
          console.log(`Inquiry completed: ${inquiryId} with status ${status}`);
        },
        onCancel: ({ inquiryId, sessionToken }) => {
          console.log('Inquiry cancelled', { inquiryId, sessionToken });
        },
        onError: (error) => {
          console.error('Persona error:', error);
        },
      });
    };

    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  return (
    <main>
      <div>
        🥳 App successfully hosted.
      </div>
    </main>
  );
}

export default App;