// the title displayed at the top of a uic-ref-area

export const getUIC_Ref_Title_DivStart = async (link: string, refCount: number, isPopover:boolean): Promise<string> => {
    return `<div class="snw-ref-title">
            References for: ${link}`;
}


export const getUIC_ref_title_DivEnd = async (): Promise<string> => {
    return "</div>";
}