export default async (request, response) => {
	// Your logic here
	response.send('Page content', request.path_parameters);
};
