// functions/tools.js
// Server-side PDF conversions: PDF -> Word / Excel / PowerPoint
const{onDocumentCreated}=require("firebase-functions/v2/firestore");
const admin=require("firebase-admin");
const pdfParse=require("pdf-parse");
const{audit}=require("./util");
const{Document,Packer,Paragraph,HeadingLevel}=require("docx");
const ExcelJS=require("exceljs");
const PptxGenJS=require("pptxgenjs");

const EXT={pdf2word:"docx",pdf2excel:"xlsx",pdf2ppt:"pptx"};

exports.runConversion=onDocumentCreated(
  {document:"users/{uid}/conversions/{id}",memory:"2GiB",timeoutSeconds:540},
  async ev=>{
    const ref=ev.data.ref,d=ev.data.data(),ext=EXT[d.tool];
    if(!ext||!d.inputPath?.startsWith(`users/${ev.params.uid}/`)){
      return ref.update({status:"failed",error:"Unsupported request"});
    }

    try{
      await ref.update({status:"processing"});
      const b=admin.storage().bucket();
      const [buf]=await b.file(d.inputPath).download();

      // Extract text. pdf-parse splits pages with \f (form feed)
      const parsed=await pdfParse(buf);
      const pages=(parsed.text||"").split("\f").map(p=>
        p.split("\n").map(l=>l.trim()).filter(Boolean)
      );

      // ---------- shared helpers ----------
      const clean=s=>s
        .replace(/^[\s•·▪◦‣⁃\-–—]+/,"")
        .replace(/\s+/g," ")
        .trim();

      const isHeading=s=>{
        const t=s.trim();
        if(t.length<3||t.length>80) return false;
        if(/[.!?:;,]$/.test(t)) return false;
        if(/^\d+(\.\d+)*[.)]?\s+\S/.test(t)) return true;   // 1.2 Title
        if(t===t.toUpperCase()&&/[A-Z]{3,}/.test(t)) return true; // ALL CAPS
        if(/^[A-Z][\w\s\-&']{2,60}$/.test(t)&&t.split(" ").length<=10) return true;
        return false;
      };

      // blockify a page: {title, bullets[]} structure
      const blockify=pg=>{
        const lines=pg.map(clean).filter(Boolean);
        const blocks=[];
        let cur={title:null,bullets:[]};
        lines.forEach((l,i)=>{
          if(isHeading(l)){
            if(cur.title||cur.bullets.length) blocks.push(cur);
            cur={title:l,bullets:[]};
          }else{
            cur.bullets.push(l);
          }
        });
        if(cur.title||cur.bullets.length) blocks.push(cur);
        if(!blocks.length) blocks.push({title:null,bullets:lines});
        return blocks;
      };

      let out;

      // ---------- DOCX ----------
      if(ext==="docx"){
        const kids=[];
        // Title
        const docTitle=clean(pages[0]?.find(isHeading)||"")||"Converted Document";
        kids.push(new Paragraph({text:docTitle,heading:HeadingLevel.TITLE}));
        kids.push(new Paragraph({text:"",spacing:{after:240}}));

        pages.forEach((pg,pageIdx)=>{
          const blocks=blockify(pg);
          blocks.forEach(block=>{
            if(block.title){
              kids.push(new Paragraph({
                text:block.title,
                heading:block.title.length<40?HeadingLevel.HEADING_1:HeadingLevel.HEADING_2,
                spacing:{before:240,after:120}
              }));
            }
            block.bullets.forEach(b=>{
              kids.push(new Paragraph({text:b,bullet:{level:0},spacing:{after:100}}));
            });
          });
          // Page break between PDF pages
          if(pageIdx<pages.length-1){
            kids.push(new Paragraph({text:"",pageBreakBefore:true}));
          }
        });

        out=await Packer.toBuffer(new Document({
          creator:"PDF2WEB",
          title:docTitle,
          sections:[{children:kids}]
        }));
      }

      // ---------- XLSX ----------
      if(ext==="xlsx"){
        const wb=new ExcelJS.Workbook();
        wb.creator="PDF2WEB";
        const ws=wb.addWorksheet("Content");
        ws.columns=[
          {header:"Page",key:"page",width:8},
          {header:"Type",key:"type",width:12},
          {header:"Text",key:"text",width:100}
        ];
        ws.getRow(1).font={bold:true};
        ws.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF1E6B3A"}};
        ws.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};

        pages.forEach((pg,i)=>{
          const blocks=blockify(pg);
          blocks.forEach(block=>{
            if(block.title){
              ws.addRow({page:i+1,type:"Heading",text:block.title});
            }
            block.bullets.forEach(b=>{
              ws.addRow({page:i+1,type:"Bullet",text:b});
            });
          });
        });
        ws.eachRow((row,i)=>{
          if(i>1) row.alignment={wrapText:true,vertical:"top"};
        });
        out=await wb.xlsx.writeBuffer();
      }

      // ---------- PPTX ----------
      if(ext==="pptx"){
        const px=new PptxGenJS();
        px.layout="LAYOUT_WIDE";
        px.author="PDF2WEB";
        px.title="Presentation";

        const BULLET_MAX=8;

        // Detect doc title
        const firstPage=pages[0]||[];
        const docTitle=clean(firstPage.find(isHeading)||"")||"Presentation";
        const docSub=clean(firstPage.find(l=>l.length>40&&!isHeading(l))||"").slice(0,140);

        // 1) Title slide
        const ts=px.addSlide();
        ts.background={color:"1E6B3A"};
        ts.addText(docTitle,{
          x:0.6,y:2.2,w:12.1,h:1.6,
          fontSize:40,bold:true,color:"FFFFFF",align:"center"
        });
        if(docSub){
          ts.addText(docSub,{
            x:0.6,y:4.0,w:12.1,h:1.2,
            fontSize:18,color:"E8F5EE",align:"center",italic:true
          });
        }
        ts.addText("Converted from PDF by PDF2WEB",{
          x:0.6,y:6.6,w:12.1,h:0.4,
          fontSize:10,color:"B8D8C4",align:"center"
        });

        // 2) Content slides
        pages.forEach((pg,pageIdx)=>{
          const blocks=blockify(pg);
          blocks.forEach(block=>{
            // Skip a title-only block if it duplicates docTitle on page 1
            if(pageIdx===0&&block.title===docTitle&&!block.bullets.length) return;

            // Chunk bullets into slides
            const chunks=[];
            if(block.bullets.length<=BULLET_MAX){
              chunks.push(block.bullets);
            } else {
              for(let i=0;i<block.bullets.length;i+=BULLET_MAX){
                chunks.push(block.bullets.slice(i,i+BULLET_MAX));
              }
            }
            if(!chunks.length) chunks.push([]);

            chunks.forEach((chunk,ci)=>{
              const s=px.addSlide();

              // Header bar
              s.addShape(px.ShapeType.rect,{
                x:0,y:0,w:13.33,h:1.1,
                fill:{color:"1E6B3A"},line:{color:"1E6B3A"}
              });

              // Title
              const titleText=block.title
                ? block.title
                : (chunks.length>1
                    ? `Page ${pageIdx+1} (${ci+1}/${chunks.length})`
                    : `Page ${pageIdx+1}`);
              s.addText(titleText,{
                x:0.5,y:0.15,w:12.3,h:0.8,
                fontSize:22,bold:true,color:"FFFFFF",valign:"middle"
              });

              // Body
              if(chunk.length){
                const fs=chunk.length>6?14:16;
                const bulletObjs=chunk.map(t=>({
                  text:t,
                  options:{bullet:{code:"2022"},breakLine:true,paraSpaceAfter:6}
                }));
                s.addText(bulletObjs,{
                  x:0.7,y:1.5,w:12,h:5.6,
                  fontSize:fs,color:"1A1A1A",valign:"top"
                });
              }

              // Page number footer
              s.addText(String(pageIdx+1),{
                x:12.3,y:7.0,w:0.8,h:0.4,
                fontSize:10,color:"9AA79F",align:"right"
              });
            });
          });
        });

        out=await px.write({outputType:"nodebuffer"});
      }

      const path=`users/${ev.params.uid}/conversions/${ev.params.id}/output.${ext}`;
      await b.file(path).save(Buffer.from(out));
      await ref.update({
        status:"completed",
        outputPath:path,
        outName:d.name.replace(/\.pdf$/i,"")+"."+ext
      });
      await audit("conversion_completed",ev.params.uid,{tool:d.tool});
    }catch(e){
      console.error(e);
      await ref.update({status:"failed",error:"We couldn't convert this file."});
    }
  }
);