import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export const autoTranslate = async (req,res)=>{

 try{

  const {title,description,sourceLang} = req.body;

  const languages = ["th","en","zh"];

  const targets = languages.filter(l => l !== sourceLang);

  const result = {};

  for(const lang of targets){

    const response = await openai.chat.completions.create({
      model:"gpt-4o-mini",
      messages:[
        {
          role:"system",
          content:"You are a professional tourism translator."
        },
        {
          role:"user",
          content:`Translate to ${lang}

Title: ${title}
Description: ${description}

Return JSON:
{
"title":"",
"description":""
}`
        }
      ]
    });

    const text = response.choices[0].message.content;

    result[lang] = JSON.parse(text);

  }

  res.json(result);

 }catch(err){

  res.status(500).json({error:err.message})

 }

}