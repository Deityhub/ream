// "Use in another tool": the finished files wait here while the app navigates to the next tool page.
let pending: File[] = []

export const setHandoff = (files: File[]) => { pending = files }
/** peek rather than take, so React StrictMode's double render doesn't lose the files */
export const peekHandoff = () => pending
export const clearHandoff = () => { pending = [] }
