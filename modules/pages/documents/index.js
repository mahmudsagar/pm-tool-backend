export default async (request, response) => {
	// Your logic here
	const result = await global.Page.find();
	console.log(result);
	
	response.send('Page content', result);
};
