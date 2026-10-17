// The classes of the forms in AuthFrame (sign-in and the two emailed links): the fields, links
// and buttons of the signed-in pages.

export const label = 'text-[12px] leading-none font-semibold text-muted lg:text-[14px]'
// The box shows the focus. The browser's ring around the bare <input> covers the caret.
export const input = 'mt-[11.5px] flex h-[35px] items-center rounded-[5px] border-[0.5px] border-card-line bg-field px-[9px] text-[12px] font-medium focus-within:border-accent light:shadow-(--shadow-card) lg:mt-[14px] lg:h-[50px] lg:px-[17px] lg:text-[14px]'
export const field = 'min-w-0 flex-1 bg-transparent text-ink text-ellipsis outline-none placeholder:text-muted'
// Errors take text-red, notices text-accent, the rest text-muted.
export const message = 'text-[12px] leading-[16px] font-medium lg:text-[14px] lg:leading-[18px]'
export const link = 'font-semibold text-accent underline underline-offset-[2.5px] lg:underline-offset-[3px]'
export const mainButton = 'bg-cta flex h-[45px] w-full items-center justify-center gap-[8px] rounded-[5px] border-[0.5px] border-card-line text-[12px] font-semibold text-white light:border-0 disabled:opacity-60 lg:h-[50px] lg:text-[16px] lg:font-medium'
export const outlineButton = 'button-outline grid h-[40px] place-items-center rounded-[5px] px-[24px] text-[12px] font-semibold lg:text-[14px]'
export const stack = 'flex flex-col gap-[20px] lg:gap-[25px]'
