import { useEffect, useState } from 'react';

export function useSingleInstance() {
  const [isDuplicate, setIsDuplicate] = useState(false);

  useEffect(() => {
    const channel = new BroadcastChannel('lanzo_pos_instance');

    // 1. Preguntar si hay alguien más
    channel.postMessage({ type: 'CHECK_EXISTING' });

    // 2. Escuchar respuestas
    channel.onmessage = (event) => {
      if (event.data.type === 'CHECK_EXISTING') {
        // Alguien nuevo entró, le decimos que nosotros ya estamos aquí
        channel.postMessage({ type: 'I_AM_HERE' });
      } else if (event.data.type === 'I_AM_HERE') {
        // Alguien respondió, significa que somos la segunda pestaña
        setIsDuplicate(true);
      }
    };

    return () => {
      channel.close();
    };
  }, []);

  return isDuplicate;
}