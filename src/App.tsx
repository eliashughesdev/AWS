import Persona from 'persona'
import { useEffect } from 'react';

function App() {
  useEffect(() => {
    const client = new Persona.Client({
      templateId: "itmpl_1sUZyGnyr37FxJVbcJioqM6x",
      referenceId: "testuser-123",
      environmentId: "env_p6vqJA4rT688ztP3c6AHojQo",
      onReady: () => {
        console.log('Persona client ready, opening...');
        client.open();
      },
      onComplete: ({ inquiryId, status, fields}: any) => {
        // Inquiry completed. Optionally tell your server about it.
        console.log(`Sending finished inquiry ${inquiryId} to backend with ${status} and ${fields}`);
      },
      onCancel: ({ inquiryId, sessionToken }: any) => {
        console.log('Inquiry cancelled', { inquiryId, sessionToken });
      },
      onError: (error: any) => {
        console.error('Persona error:', error);
      },
    });

    // Cleanup on unmount if needed
    return () => {
      if (client) {
        client.cancel(false);
      }
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
