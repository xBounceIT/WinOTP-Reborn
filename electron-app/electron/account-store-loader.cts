function createAccountStoreLoader(factory, onError: (error: unknown) => void = () => {}) {
  let store;

  return {
    get() {
      if (store) {
        return store;
      }

      try {
        store = factory();
      } catch (error) {
        onError(error);
      }

      return store;
    },

    close() {
      const currentStore = store;
      store = undefined;
      try {
        currentStore?.close();
      } catch (error) {
        onError(error);
      }
    },
  };
}

module.exports = { createAccountStoreLoader };
