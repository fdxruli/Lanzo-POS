import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const BotScreenContext = createContext(null);
export const BotScreenProvider = ({ children }) => {
  const [screen, setScreen] = useState(null);
  const value = useMemo(() => ({ screen, setScreen }), [screen]);
  return <BotScreenContext.Provider value={value}>{children}</BotScreenContext.Provider>;
};
export const useBotScreenContext = () => useContext(BotScreenContext)?.screen;
// Explicitly publish tabs which live outside the URL; never inspect the DOM or business data.
export const usePublishBotScreen = (pathname, tab) => {
  const setScreen = useContext(BotScreenContext)?.setScreen;
  useEffect(() => {
    if (!setScreen) return;
    const screen = { pathname, tab };
    setScreen(screen);
    return () => setScreen(current => current === screen ? null : current);
  }, [pathname, tab, setScreen]);
};
