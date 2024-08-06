export default async (request, response) => {
	// Your logic here
    const body = await request.json();
    console.log(await request.json());
    try{
        let res = await global.Page.create(body)
        response.json("success",res)
    }catch(err){
        console.log("err");
        response.json(err)        
    }
	// response.json(body);
};
