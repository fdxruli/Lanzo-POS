const { create } = require('zustand');

const useStore = create((set) => ({
  order: [],
  _isSyncing: true,
  setSync: (val) => set({ _isSyncing: val })
}));

useStore.subscribe((state, prevState) => {
  console.log("Listener ran. state.order !== prevState.order:", state.order !== prevState.order);
});

useStore.getState().setSync(false);
