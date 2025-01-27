import { Handler } from './interface'
import { trapOn, trapOff, TrapEventMap } from './traps'

type Handlers = Set<Handler>

type ElToHandlers = Map<EventTarget, Handlers>

interface TypeToHandlers {
  [key: string]: Handlers | undefined
}

type Phase = 'capture' | 'bubble'

// TODO add global event listener
interface Delegate {
  on: (<K extends keyof HTMLElementEventMap>(
    type: K,
    el: HTMLElement,
    handler: (e: HTMLElementEventMap[K]) => any,
    useCapture?: boolean
  ) => void) &
  (<K extends keyof HTMLElementEventMap>(
    type: K,
    el: HTMLElement,
    handler: (e: HTMLElementEventMap[K]) => any,
    options?: EventListenerOptions
  ) => void) &
  (<K extends keyof WindowEventMap>(
    type: K,
    el: Window,
    handler: (e: WindowEventMap[K]) => any,
    useCapture?: boolean
  ) => void) &
  (<K extends keyof WindowEventMap>(
    type: K,
    el: Window,
    handler: (e: WindowEventMap[K]) => any,
    options?: EventListenerOptions
  ) => void) &
  (<K extends keyof DocumentEventMap>(
    type: K,
    el: Document,
    handler: (e: DocumentEventMap[K]) => any,
    useCapture?: boolean
  ) => void) &
  (<K extends keyof DocumentEventMap>(
    type: K,
    el: Document,
    handler: (e: DocumentEventMap[K]) => any,
    options?: EventListenerOptions
  ) => void) &
  (<K extends keyof TrapEventMap>(
    type: K,
    el: HTMLElement,
    handler: (e: TrapEventMap[K]) => any,
    useCapture?: boolean
  ) => void) &
  (<K extends keyof TrapEventMap>(
    type: K,
    el: HTMLElement,
    handler: (e: TrapEventMap[K]) => any,
    options?: EventListenerOptions
  ) => void) &
  ((
    type: String,
    el: EventTarget,
    handler: EventListener,
    useCapture?: boolean
  ) => void) &
  ((
    type: String,
    el: EventTarget,
    handler: EventListener,
    useCapture?: boolean
  ) => void) &
  ((
    type: String,
    el: EventTarget,
    handler: EventListener,
    options?: EventListenerOptions
  ) => void)
  off: (<K extends keyof HTMLElementEventMap>(
    type: K,
    el: HTMLElement,
    handler: (e: HTMLElementEventMap[K]) => any,
    useCapture?: boolean
  ) => void) &
  (<K extends keyof HTMLElementEventMap>(
    type: K,
    el: HTMLElement,
    handler: (e: HTMLElementEventMap[K]) => any,
    options?: EventListenerOptions
  ) => void) &
  (<K extends keyof WindowEventMap>(
    type: K,
    el: Window,
    handler: (e: WindowEventMap[K]) => any,
    useCapture?: boolean
  ) => void) &
  (<K extends keyof WindowEventMap>(
    type: K,
    el: Window,
    handler: (e: WindowEventMap[K]) => any,
    options?: EventListenerOptions
  ) => void) &
  (<K extends keyof DocumentEventMap>(
    type: K,
    el: Document,
    handler: (e: DocumentEventMap[K]) => any,
    useCapture?: boolean
  ) => void) &
  (<K extends keyof DocumentEventMap>(
    type: K,
    el: Document,
    handler: (e: DocumentEventMap[K]) => any,
    options?: EventListenerOptions
  ) => void) &
  (<K extends keyof TrapEventMap>(
    type: K,
    el: HTMLElement,
    handler: (e: TrapEventMap[K]) => any,
    useCapture?: boolean
  ) => void) &
  (<K extends keyof TrapEventMap>(
    type: K,
    el: HTMLElement,
    handler: (e: TrapEventMap[K]) => any,
    options?: EventListenerOptions
  ) => void) &
  ((
    type: string,
    el: EventTarget,
    handler: EventListener,
    useCapture?: boolean
  ) => void) &
  ((
    type: string,
    el: EventTarget,
    handler: EventListener,
    options?: EventListenerOptions
  ) => void)
}

// currently `once` and `passive` is not supported
function createDelegate (): Delegate {
  if (typeof window === 'undefined') {
    return {
      on: () => {},
      off: () => {}
    }
  }
  const propagationStopped = new WeakMap<Event, boolean>()
  const immediatePropagationStopped = new WeakMap<Event, boolean>()

  function trackPropagation (this: Event): void {
    propagationStopped.set(this, true)
  }

  function trackImmediate (this: Event): void {
    propagationStopped.set(this, true)
    immediatePropagationStopped.set(this, true)
  }

  function spy (event: Event, propName: keyof Event, fn: Function): Event {
    const source = event[propName];
    (event as any)[propName] = function () {
      fn.apply(event, arguments)
      return (source as any).apply(event, arguments)
    } as any
    return event
  }

  function unspy (event: Event, propName: keyof Event): void {
    (event as any)[propName] = Event.prototype[propName]
  }

  const currentTargets = new WeakMap<Event, EventTarget>()
  const currentTargetDescriptor = Object.getOwnPropertyDescriptor(
    Event.prototype,
    'currentTarget'
  )
  function getCurrentTarget (this: Event): EventTarget | null {
    return currentTargets.get(this) ?? null
  }

  function defineCurrentTarget (
    event: Event,
    getter?: () => EventTarget | null
  ): void {
    if (currentTargetDescriptor === undefined) return
    Object.defineProperty(event, 'currentTarget', {
      configurable: true,
      enumerable: true,
      get: getter ?? currentTargetDescriptor.get
    })
  }

  const phaseToTypeToElToHandlers: {
    bubble: {
      [key: string]: ElToHandlers | undefined
    }
    capture: {
      [key: string]: ElToHandlers | undefined
    }
  } = {
    bubble: {},
    capture: {}
  }
  const typeToWindowEventHandlers: TypeToHandlers = {}

  function createUnifiedHandler (): Handler {
    const delegeteHandler = function (e: Event): void {
      const { type, eventPhase, target, bubbles } = e
      if (eventPhase === 2) return
      const phase = eventPhase === 1 ? 'capture' : 'bubble'
      let cursor = target
      const path = []
      // collecting bubble path
      while (true) {
        if (cursor === null) cursor = window
        path.push(cursor)
        if (cursor === window) {
          break
        }
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        cursor = ((cursor as any).parentNode || null) as EventTarget | null
      }
      const captureElToHandlers = phaseToTypeToElToHandlers.capture[type]
      const bubbleElToHandlers = phaseToTypeToElToHandlers.bubble[type]

      spy(e, 'stopPropagation', trackPropagation)
      spy(e, 'stopImmediatePropagation', trackImmediate)
      defineCurrentTarget(e, getCurrentTarget)

      if (phase === 'capture') {
        if (captureElToHandlers === undefined) return
        // capture
        for (let i = path.length - 1; i >= 0; --i) {
          if (propagationStopped.has(e)) break
          const target = path[i]
          const handlers = captureElToHandlers.get(target)
          if (handlers !== undefined) {
            currentTargets.set(e, target)
            for (const handler of handlers) {
              if (immediatePropagationStopped.has(e)) break
              handler(e)
            }
          }
          if (i === 0 && !bubbles && bubbleElToHandlers !== undefined) {
            const bubbleHandlers = bubbleElToHandlers.get(target)
            if (bubbleHandlers !== undefined) {
              for (const handler of bubbleHandlers) {
                if (immediatePropagationStopped.has(e)) break
                handler(e)
              }
            }
          }
        }
      } else if (phase === 'bubble') {
        if (bubbleElToHandlers === undefined) return
        // bubble
        for (let i = 0; i < path.length; ++i) {
          if (propagationStopped.has(e)) break
          const target = path[i]
          const handlers = bubbleElToHandlers.get(target)
          if (handlers !== undefined) {
            currentTargets.set(e, target)
            for (const handler of handlers) {
              if (immediatePropagationStopped.has(e)) break
              handler(e)
            }
          }
        }
      }
      unspy(e, 'stopPropagation')
      unspy(e, 'stopImmediatePropagation')
      defineCurrentTarget(e)
    }
    delegeteHandler.displayName = 'evtdUnifiedHandler'
    return delegeteHandler
  }
  function createUnifiedWindowEventHandler (): Handler {
    const delegateHandler = function (e: Event): void {
      const { type, eventPhase } = e
      if (eventPhase !== 2) return
      const handlers = typeToWindowEventHandlers[type]
      if (handlers === undefined) return
      handlers.forEach((handler) => handler(e))
    }
    delegateHandler.displayName = 'evtdUnifiedWindowEventHandler'
    return delegateHandler
  }

  const unifiedHandler = createUnifiedHandler()
  const unfiendWindowEventHandler = createUnifiedWindowEventHandler()

  function ensureElToHandlers (phase: Phase, type: string): ElToHandlers {
    const phaseHandlers = phaseToTypeToElToHandlers[phase]
    if (phaseHandlers[type] === undefined) {
      phaseHandlers[type] = new Map()
      window.addEventListener(type, unifiedHandler, phase === 'capture')
    }
    return phaseHandlers[type] as ElToHandlers
  }
  function ensureWindowEventHandlers (type: string): Handlers {
    const windowEventHandlers = typeToWindowEventHandlers[type]
    if (windowEventHandlers === undefined) {
      typeToWindowEventHandlers[type] = new Set()
      window.addEventListener(type, unfiendWindowEventHandler)
    }
    return typeToWindowEventHandlers[type] as Handlers
  }
  function ensureHandlers (
    elToHandlers: ElToHandlers,
    el: EventTarget
  ): Handlers {
    let elHandlers = elToHandlers.get(el)
    if (elHandlers === undefined) {
      elToHandlers.set(el, (elHandlers = new Set()))
    }
    return elHandlers
  }
  function handlerExist (
    el: EventTarget,
    phase: Phase,
    type: string,
    handler: Handler
  ): boolean {
    const elToHandlers = phaseToTypeToElToHandlers[phase][type]
    // phase ${type} event has handlers
    if (elToHandlers !== undefined) {
      const handlers = elToHandlers.get(el)
      // phase using el with ${type} event has handlers
      if (handlers !== undefined) {
        if (handlers.has(handler)) return true
      }
    }
    return false
  }
  function windowEventHandlerExist (type: string, handler: Handler): boolean {
    const handlers = typeToWindowEventHandlers[type]
    if (handlers !== undefined) {
      if (handlers.has(handler)) {
        return true
      }
    }
    return false
  }
  function on (
    type: string,
    el: EventTarget,
    handler: Handler,
    options?: boolean | EventListenerOptions
  ): void {
    const trapped = trapOn(type as any, el as Element, handler, options)
    if (trapped) return
    const phase =
      options === true ||
      (typeof options === 'object' && options.capture === true)
        ? 'capture'
        : 'bubble'
    const elToHandlers = ensureElToHandlers(phase, type)
    const handlers = ensureHandlers(elToHandlers, el)
    if (!handlers.has(handler)) handlers.add(handler)
    if (el === window) {
      const windowEventHandlers = ensureWindowEventHandlers(type)
      if (!windowEventHandlers.has(handler)) {
        windowEventHandlers.add(handler)
      }
    }
  }
  function off (
    type: string,
    el: EventTarget,
    handler: Handler,
    options?: boolean | EventListenerOptions
  ): void {
    const trapped = trapOff(type as any, el as Element, handler, options)
    if (trapped) return
    const capture =
      options === true ||
      (typeof options === 'object' && options.capture === true)
    const phase: Phase = capture ? 'capture' : 'bubble'
    const elToHandlers = ensureElToHandlers(phase, type)
    const handlers = ensureHandlers(elToHandlers, el)
    if (el === window) {
      const mirrorPhase: Phase = capture ? 'bubble' : 'capture'
      if (
        !handlerExist(el, mirrorPhase, type, handler) &&
        windowEventHandlerExist(type, handler)
      ) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const windowEventHandlers = typeToWindowEventHandlers[type]!
        windowEventHandlers.delete(handler)
        if (windowEventHandlers.size === 0) {
          window.removeEventListener(type, unfiendWindowEventHandler)
          typeToWindowEventHandlers[type] = undefined
        }
      }
    }
    if (handlers.has(handler)) handlers.delete(handler)
    if (handlers.size === 0) {
      elToHandlers.delete(el)
    }
    if (elToHandlers.size === 0) {
      window.removeEventListener(type, unifiedHandler, phase === 'capture')
      phaseToTypeToElToHandlers[phase][type] = undefined
    }
  }

  return {
    on: on as any,
    off: off as any
  }
}

const { on, off } = createDelegate()

export { on, off }
