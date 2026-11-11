// Web Serial yeniden bağlanmasını tek bir sıraya alır: eski okuyucu tamamen kapanmadan yenisi açılmaz.
export function createReaderReconnectCoordinator({
  open,
  onState = () => {},
  onConnected = () => {},
  onError = () => {},
  retryDelay = 150,
  staleDisconnectDelay = 100,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = handle => clearTimeout(handle),
}) {
  let active = true;
  let manual = false;
  let current = null;
  let currentToken = null;
  let openingToken = null;
  let pending = null;
  let serial = Promise.resolve();
  const endedGenerations = new Map();
  const expectedStaleDisconnects = new Map();

  const rememberEndedGeneration = token => {
    if (token.closing || !token.port) return;
    let generations = endedGenerations.get(token.port);
    if (!generations) {
      generations = new Set();
      endedGenerations.set(token.port, generations);
    }
    generations.add(token);
  };
  const clearEndedGenerations = port => {
    if (port == null) endedGenerations.clear();
    else endedGenerations.delete(port);
  };
  const latestEndedGeneration = port => {
    const generations = endedGenerations.get(port);
    if (!generations?.size) return null;
    return [...generations].at(-1);
  };
  const clearExpectedStaleDisconnect = port => {
    const marker = expectedStaleDisconnects.get(port);
    if (!marker) return;
    expectedStaleDisconnects.delete(port);
    if (marker.timer != null) clearTimer(marker.timer);
  };
  const clearExpectedStaleDisconnects = () => {
    for (const port of [...expectedStaleDisconnects.keys()]) clearExpectedStaleDisconnect(port);
  };
  const clearCausalState = port => {
    if (port == null) {
      clearEndedGenerations(null);
      clearExpectedStaleDisconnects();
      return;
    }
    clearEndedGenerations(port);
    clearExpectedStaleDisconnect(port);
  };
  const expectStaleDisconnect = (port, endedToken, replacementToken) => {
    clearExpectedStaleDisconnect(port);
    expectedStaleDisconnects.set(port, { endedToken, replacementToken, timer: null });
  };
  const stabilizeReplacement = (port, replacementToken) => {
    const marker = expectedStaleDisconnects.get(port);
    if (!marker || marker.replacementToken !== replacementToken) return;
    marker.timer = setTimer(() => {
      if (expectedStaleDisconnects.get(port) !== marker) return;
      expectedStaleDisconnects.delete(port);
      clearEndedGenerations(port);
    }, staleDisconnectDelay);
  };
  const consumeExpectedStaleDisconnect = port => {
    const marker = expectedStaleDisconnects.get(port);
    if (!marker) return false;
    if (marker.replacementToken !== currentToken && marker.replacementToken !== openingToken) {
      clearExpectedStaleDisconnect(port);
      return false;
    }
    clearExpectedStaleDisconnect(port);
    return true;
  };

  const wait = () => retryDelay > 0 ? new Promise(resolve => setTimeout(resolve, retryDelay)) : Promise.resolve();
  const closeCurrent = async () => {
    const reader = current;
    const token = currentToken;
    current = null;
    currentToken = null;
    if (!reader) return;
    if (token) token.closing = true;
    await reader.disconnect().catch(() => {});
  };
  const disconnected = token => {
    token.disconnected = true;
    if (token.closing) return;
    if (openingToken === token) {
      rememberEndedGeneration(token);
      return;
    }
    if (currentToken !== token) return;
    rememberEndedGeneration(token);
    current = null;
    currentToken = null;
    onState('idle');
    if (active && !manual && pending) schedule();
  };
  const processPending = async () => {
    while (active && !manual && pending) {
      const request = pending;
      pending = null;
      await closeCurrent();
      if (!active || manual) return;
      onState('connecting');
      const token = { disconnected: false, closing: false, port: request.port };
      openingToken = token;
      if (request.endedToken) expectStaleDisconnect(request.port, request.endedToken, token);
      try {
        const reader = await open(request.port, () => disconnected(token));
        token.port = reader?.port || request.port;
        openingToken = null;
        if (token.disconnected || !active || manual || pending) {
          clearExpectedStaleDisconnect(request.port);
          token.closing = true;
          await reader.disconnect().catch(() => {});
          continue;
        }
        current = reader;
        currentToken = token;
        onState('connected');
        onConnected(reader);
        stabilizeReplacement(request.port, token);
      } catch (cause) {
        openingToken = null;
        clearCausalState(null);
        if (active) onState('idle');
        if (active && !manual) onError(cause, request.port);
        if (active && !manual && request.retries > 0 && !pending) {
          await wait();
          pending = { port: request.port, retries: request.retries - 1, endedToken: null };
        }
      }
    }
  };
  function schedule() {
    serial = serial.then(processPending, processPending);
    return serial;
  }

  return {
    currentReader: () => current,
    connect(port = null) {
      if (!active) return serial;
      manual = false;
      clearCausalState(null);
      pending = { port, retries: 0, endedToken: null };
      return schedule();
    },
    // Yalnızca tarayıcının connect olayı, önceki neslin gecikmiş disconnect olayını beklemeyi doğrular.
    portConnected(port) {
      if (!active) return serial;
      manual = false;
      const endedToken = openingToken?.port === port
        ? openingToken
        : currentToken?.port === port
          ? currentToken
          : latestEndedGeneration(port);
      clearCausalState(port);
      pending = { port, retries: 1, endedToken };
      return schedule();
    },
    portDisconnected(port) {
      serial = serial.then(async () => {
        if (!active || manual) return;
        if (consumeExpectedStaleDisconnect(port)) return;
        const disconnectedReader = current;
        const disconnectedToken = currentToken;
        if (!disconnectedReader || !disconnectedToken || disconnectedToken.port !== port) {
          clearEndedGenerations(port);
          return;
        }
        if (current === disconnectedReader && currentToken === disconnectedToken) {
          await closeCurrent();
          if (active) onState('idle');
        }
      });
      return serial;
    },
    manualDisconnect() {
      manual = true;
      pending = null;
      clearCausalState(null);
      serial = serial.then(async () => { await closeCurrent(); if (active) onState('idle'); }, async () => { await closeCurrent(); if (active) onState('idle'); });
      return serial;
    },
    dispose() {
      active = false;
      manual = true;
      pending = null;
      clearCausalState(null);
      serial = serial.then(closeCurrent, closeCurrent);
      return serial;
    },
  };
}