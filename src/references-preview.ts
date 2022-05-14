import {MarkdownPostProcessorContext, Plugin} from "obsidian";
import htmlReferenceElement from "./htmlDecorations";
import {getCurrentPage} from "./indexer";

export default function markdownPreviewProcessor(el: HTMLElement, ctx : MarkdownPostProcessorContext, thePlugin : Plugin) {
    const transformedCache = getCurrentPage({file: thePlugin.app.vault.fileMap[ctx.sourcePath], app: thePlugin.app});
    if(transformedCache?.blocks || transformedCache.embedsWithDuplicates || transformedCache.headings || transformedCache.linksWithoutDuplicates  ) {
        const sectionInfo = ctx.getSectionInfo(el);
    
        if(transformedCache?.blocks) {
            for (const value of transformedCache.blocks) {
                if(value.references.length>0 && value.pos.end.line === sectionInfo.lineEnd) {
                    const referenceElement = htmlReferenceElement(value.references.length, "block", value.key);
                    let blockElement: HTMLElement = el.querySelector('p')
                    if(!blockElement) {
                        blockElement = el.querySelector("li");
                    }
                    if(!blockElement.hasClass("snw-block-preview")) {
                        blockElement.append(referenceElement);
                        blockElement.addClass("snw-block-preview");
                        break;
                    }
                }
            }
        }
        
        if(transformedCache?.embedsWithDuplicates) {
            console.log("embedsWithDuplicates", transformedCache.embedsWithDuplicates);
            el.querySelectorAll(".internal-embed:not(.snw-embed-preview)").forEach(element => {
                const embedKey = element.getAttribute('src');
                for (const value of transformedCache.embedsWithDuplicates) {
                    if(value.references.length>0 && embedKey.endsWith(value.key)) {
                        element.addClass('snw-embed-preview');
                        element.after(htmlReferenceElement(value.references.length, "embed", value.key));
                        break; 
                    }
                }
            });
        }
        
        if(transformedCache?.headings && el.querySelector("[data-heading]") ) {
            const headerKey = el.querySelector("[data-heading]").textContent;
            for (const value of transformedCache.headings) 
                if(value.references.length>0 && value.key === headerKey) {
                    const referenceElement = htmlReferenceElement(value.references.length, "heading", value.key);
                    el.querySelector("h1").insertAdjacentElement("beforeend", referenceElement);
                    el.querySelector("h1").addClass("snw-heading-preview");
                    break;
                }
        }

        if(transformedCache?.linksWithoutDuplicates) {
            el.querySelectorAll("a.internal-link:not(.snw-link-preview)").forEach(element => {
                const link = element.getAttribute('data-href');
                for (const value of transformedCache.linksWithoutDuplicates) 
                    if(value.references.length>0 && value.key === link) {
                        element.addClass('snw-link-preview');
                        element.after(htmlReferenceElement(value.references.length, "link", value.key));
                        break; 
                    }
            });
        }    
    }
}

