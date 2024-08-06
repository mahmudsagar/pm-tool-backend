// import Test from '../../models/test';
export default async (request, response) => {
	// Your logic here
    console.log('test post request');
    
    const body = await request.json();
    console.log(global);
    try{
        const testResult = await global.MongoTest.create(body);
        console.log(testResult);
        
        response.json(testResult)
    }catch(err){
        console.log(err);
        
        response.json(err)
    }
    
};
