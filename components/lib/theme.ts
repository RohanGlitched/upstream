/** Runs before paint so a stored choice never flashes the other theme. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("upstream-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
