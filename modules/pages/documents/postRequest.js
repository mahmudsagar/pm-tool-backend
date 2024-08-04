export default async (request, response) => {
	// Your logic here
    const body = await request.json();
    console.log(await request.json());
    
	response.json(body);
};
